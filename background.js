// Service worker: runs the transcript → chat → Obsidian pipeline.
// Progress is written to chrome.storage.session ("job") so the popup can close and reopen.
import { PROVIDERS } from './lib/providers.js';
import { fillTemplate } from './lib/prompt.js';
import { formatTranscript, parseJson3, parseTimestamp } from './lib/transcript.js';
import { buildNote, normalizeTags, sanitizeFilename } from './lib/note.js';
import { ObsidianClient } from './lib/obsidian.js';
import {
  getSettings, getJob, setJob, getCachedTranscript, cacheTranscript, getLastResult, saveLastResult,
} from './lib/storage.js';

const POLL_MS = 1500;
const CHAT_TIMEOUT_MS = 6 * 60 * 1000;
const STALE_JOB_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class StepError extends Error {
  constructor(step, message) {
    super(message);
    this.step = step;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'run') {
    startJob(() => runPipeline(msg)).then(sendResponse);
    return true;
  }
  if (msg.type === 'retrySave') {
    startJob(() => retrySave(msg)).then(sendResponse);
    return true;
  }
  return false;
});

// In-memory guard, checked and set synchronously, so two quick clicks can't both pass the
// storage check below before either job has written its "running" state.
let busy = false;

// Starts a job unless one is already running; resolves immediately so the popup isn't blocked.
async function startJob(work) {
  if (busy) return { ok: false, error: 'A summary is already in progress.' };
  busy = true;
  const job = await getJob();
  if (job?.status === 'running' && Date.now() - job.updatedAt < STALE_JOB_MS) {
    busy = false;
    return { ok: false, error: 'A summary is already in progress.' };
  }
  work().catch(async (err) => {
    const prev = await getJob();
    await setJob({
      ...prev,
      status: 'error',
      step: err.step ?? prev?.step,
      message: err.message,
      canRetrySave: Boolean(await getLastResult()) && (err.step ?? prev?.step) === 'save',
    });
  }).finally(() => { busy = false; });
  return { ok: true };
}

async function runPipeline({ tabId, provider, vaultName, folder, tags }) {
  const settings = await getSettings();
  const config = PROVIDERS[provider];
  if (!config) throw new StepError('transcript', `Unknown provider "${provider}".`);
  findVault(settings, vaultName);
  const base = { status: 'running', provider: config.label, canRetrySave: false };

  // 1. Transcript (cached per video for the browser session).
  await setJob({ ...base, step: 'transcript', message: 'Reading the transcript…' });
  const tab = await chrome.tabs.get(tabId);
  const videoId = watchVideoId(tab.url);
  if (!videoId) throw new StepError('transcript', 'Open a YouTube video page (youtube.com/watch?v=…) first.');

  let video = await getCachedTranscript(videoId);
  if (!video) {
    video = await extractTranscript(tabId);
    await cacheTranscript(videoId, video);
  }

  // 2. Summarize: the whole prompt goes to the chat as one message.
  await setJob({ ...base, step: 'chat', title: video.meta.title, message: `Opening ${config.label}…` });
  const prompt = fillTemplate(settings.prompt, { ...video.meta, transcript: video.transcript });
  const summary = await summarizeInChat(config, prompt, { ...base, title: video.meta.title });

  const result = { meta: video.meta, provider: config.label, tags, summary, vaultName, folder };
  await saveLastResult(result);

  // 3. Save.
  await saveToObsidian(result, base);
}

async function retrySave({ vaultName, folder, tags }) {
  const last = await getLastResult();
  if (!last) throw new StepError('save', 'There is no summary to save.');
  const result = { ...last, vaultName: vaultName ?? last.vaultName, folder: folder ?? last.folder, tags: tags ?? last.tags };
  await saveLastResult(result);
  await saveToObsidian(result, { status: 'running', provider: last.provider, canRetrySave: false });
}

function watchVideoId(url) {
  try {
    const u = new URL(url);
    return /(^|\.)youtube\.com$/.test(u.hostname) && u.pathname === '/watch' ? u.searchParams.get('v') : null;
  } catch {
    return null;
  }
}

function findVault(settings, vaultName) {
  const vault = settings.vaults.find((v) => v.name === vaultName);
  if (!vault) throw new StepError('save', 'Choose an Obsidian vault. Add one in the extension options first.');
  return vault;
}

async function extractTranscript(tabId) {
  const target = { tabId };
  await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['content/youtube.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    func: () => window.__ytsYoutube.extract(),
  });
  if (!result) throw new StepError('transcript', 'Could not read this YouTube page. Reload it and try again.');
  if (result.error) throw new StepError('transcript', result.error);

  const segments = result.panel
    ? result.panel.map((s) => ({ t: parseTimestamp(s.label), text: s.text }))
    : parseJson3(result.json3);
  const transcript = formatTranscript(segments);
  if (!transcript) throw new StepError('transcript', 'The transcript was empty.');
  return { meta: result.meta, transcript };
}

function waitForTabLoad(tabId, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => { if (t.status === 'complete') done(); }).catch(done);
  });
}

const PHASE_MESSAGES = {
  starting: (label) => `Waiting for ${label} to load…`,
  sending: (label) => `Sending the transcript to ${label}…`,
  waiting: (label) => `${label} is writing the summary…`,
};

// Runs the chat in a minimized window so it happens out of sight. On success the window is closed;
// on failure it is brought to the front so the user can see why (e.g. a login page).
async function summarizeInChat(config, prompt, jobBase) {
  const win = await chrome.windows.create({ url: config.newChatUrl, state: 'minimized', focused: false });
  const tabId = win.tabs[0].id;
  // Hidden tabs can be discarded under memory pressure; this one must survive until the reply is in.
  chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});

  try {
    const markdown = await driveChat(tabId, config, prompt, jobBase);
    chrome.windows.remove(win.id).catch(() => {});
    return markdown;
  } catch (err) {
    const shown = await chrome.windows.update(win.id, { state: 'normal', focused: true }).then(() => true, () => false);
    throw new StepError('chat', shown ? `${err.message} (The ${config.label} window is now in front.)` : err.message);
  }
}

async function driveChat(tabId, config, prompt, jobBase) {
  await waitForTabLoad(tabId);
  const target = { tabId };

  try {
    await chrome.scripting.executeScript({ target, files: ['lib/html2md.js', 'content/chat.js'] });
    await chrome.scripting.executeScript({
      target,
      func: (cfg, text) => { void window.__ytsChat.start(cfg, text); },
      args: [config, prompt],
    });
  } catch (err) {
    throw new Error(`Couldn't open ${config.label}: ${err.message}`);
  }

  // Polling keeps the service worker alive while the reply streams, and each poll also runs a
  // completion check, since the minimized page's own timers are throttled.
  const end = Date.now() + CHAT_TIMEOUT_MS;
  let lastPhase = '';
  while (Date.now() < end) {
    await sleep(POLL_MS);
    let state;
    try {
      [{ result: state }] = await chrome.scripting.executeScript({
        target,
        func: () => {
          window.__ytsChat?.tick();
          return window.__ytsChat?.state;
        },
      });
    } catch {
      throw new Error(`The ${config.label} window was closed or navigated away before the reply finished.`);
    }
    if (!state) throw new Error(`The ${config.label} page reloaded before the reply finished. Try again.`);
    if (state.phase === 'done') return state.markdown;
    if (state.phase === 'error') throw new Error(state.error);
    if (state.phase !== lastPhase && PHASE_MESSAGES[state.phase]) {
      lastPhase = state.phase;
      await setJob({ ...jobBase, step: 'chat', message: PHASE_MESSAGES[state.phase](config.label) });
    }
  }
  throw new Error(`Timed out waiting for ${config.label}'s reply.`);
}

async function saveToObsidian(result, jobBase) {
  const settings = await getSettings();
  const vault = findVault(settings, result.vaultName);
  await setJob({ ...jobBase, step: 'save', title: result.meta.title, message: `Saving to ${vault.name}…` });

  const client = new ObsidianClient({ baseUrl: vault.baseUrl, apiKey: vault.apiKey });
  const body = buildNote({
    meta: result.meta,
    provider: result.provider,
    tags: normalizeTags(result.tags),
    summary: result.summary,
    now: new Date(),
  });
  let path;
  try {
    path = await client.putNote(result.folder, sanitizeFilename(result.meta.title), body);
  } catch (err) {
    throw new StepError('save', err.message);
  }

  await setJob({
    ...jobBase,
    status: 'done',
    step: 'save',
    title: result.meta.title,
    message: `Saved to ${vault.name}: ${path}`,
    obsidianUrl: `obsidian://open?vault=${encodeURIComponent(vault.name)}&file=${encodeURIComponent(path)}`,
  });
}

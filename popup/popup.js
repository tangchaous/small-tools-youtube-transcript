import { PROVIDERS, PROVIDER_IDS } from '../lib/providers.js';
import { ObsidianClient } from '../lib/obsidian.js';
import { getSettings, getLastUsed, saveLastUsed, getJob, getLastResult } from '../lib/storage.js';

const $ = (sel) => document.querySelector(sel);
const STEPS = ['transcript', 'chat', 'save'];
let settings;
let activeTab;

const isWatchPage = (url) => /^https:\/\/(www\.|m\.)?youtube\.com\/watch\?/.test(url ?? '');

function formValues() {
  return {
    provider: $('#provider').value,
    vaultName: $('#vault').value,
    folder: $('#folder').value.trim(),
    tags: $('#tags').value.trim(),
  };
}

async function loadFolders() {
  const vault = settings.vaults.find((v) => v.name === $('#vault').value);
  const list = $('#folders');
  const hint = $('#folder-hint');
  list.replaceChildren();
  hint.textContent = '';
  if (!vault) return;
  try {
    const folders = await new ObsidianClient(vault).listFolders(3);
    list.append(...folders.map((f) => new Option(f)));
  } catch (err) {
    hint.textContent = '(vault not reachable)';
    hint.title = err.message;
  }
}

function render(job) {
  const running = job?.status === 'running';
  $('#run').disabled = running || !settings.vaults.length || !isWatchPage(activeTab?.url);
  $('#job').hidden = !job;
  if (!job) return;

  const duplicate = job.status === 'duplicate';
  $('#job-title').textContent = job.title ?? '';
  // A duplicate stops before any step runs, so no step is marked.
  $('.steps').hidden = duplicate;
  const current = STEPS.indexOf(job.step);
  for (const li of document.querySelectorAll('.steps li')) {
    const i = STEPS.indexOf(li.dataset.step);
    li.className =
      job.status === 'done' || i < current ? 'done'
      : i === current ? (job.status === 'error' ? 'failed' : 'active')
      : '';
  }
  const message = $('#job-message');
  message.textContent = job.message ?? '';
  const tone = { error: 'error', done: 'ok', duplicate: 'warn' }[job.status] ?? '';
  message.className = `message ${tone}`;

  $('#open-note').hidden = !((job.status === 'done' || duplicate) && job.obsidianUrl);
  $('#open-note').textContent = duplicate ? 'Open existing note' : 'Open in Obsidian';
  $('#retry-save').hidden = !(job.status === 'error' && job.canRetrySave);
  getLastResult().then((r) => {
    $('#copy-summary').hidden = !r || running || duplicate;
  });
}

async function init() {
  settings = await getSettings();
  const last = await getLastUsed();
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  $('#provider').append(...PROVIDER_IDS.map((id) => new Option(PROVIDERS[id].label, id)));
  $('#provider').value = last?.provider ?? settings.defaultProvider;

  $('#vault').append(...settings.vaults.map((v) => new Option(v.name, v.name)));
  if (last?.vaultName && settings.vaults.some((v) => v.name === last.vaultName)) $('#vault').value = last.vaultName;
  $('#folder').value = last?.folder ?? '';
  $('#tags').value = last?.tags ?? settings.defaultTags;

  $('#no-vaults').hidden = settings.vaults.length > 0;
  $('#page-hint').hidden = isWatchPage(activeTab?.url);

  render(await getJob());
  loadFolders();
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('#run').disabled) return;
  $('#run').disabled = true;
  const values = formValues();
  await saveLastUsed(values);
  const res = await chrome.runtime.sendMessage({ type: 'run', tabId: activeTab.id, ...values });
  if (!res?.ok) {
    render({ status: 'error', step: 'transcript', message: res?.error ?? 'Could not start.' });
  }
});

$('#retry-save').addEventListener('click', async () => {
  const { vaultName, folder, tags } = formValues();
  await saveLastUsed(formValues());
  await chrome.runtime.sendMessage({ type: 'retrySave', vaultName, folder, tags });
});

$('#copy-summary').addEventListener('click', async () => {
  const result = await getLastResult();
  if (!result) return;
  await navigator.clipboard.writeText(result.summary);
  $('#copy-summary').textContent = 'Copied ✓';
  setTimeout(() => { $('#copy-summary').textContent = 'Copy summary'; }, 1500);
});

$('#open-note').addEventListener('click', async () => {
  const job = await getJob();
  if (job?.obsidianUrl) chrome.tabs.update(activeTab.id, { url: job.obsidianUrl });
});

$('#vault').addEventListener('change', loadFolders);
const openOptions = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
$('#open-options').addEventListener('click', openOptions);
$('#setup-link').addEventListener('click', openOptions);

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.job) render(changes.job.newValue);
});

init();

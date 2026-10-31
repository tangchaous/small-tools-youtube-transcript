// Generic chat-page driver, injected into the provider tab (isolated world) after lib/html2md.js.
// The service worker calls window.__ytsChat.start(config, prompt) once, then polls
// window.__ytsChat.state until phase is 'done' or 'error'.
(() => {
  if (window.__ytsChat) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TIMEOUT_MS = 5 * 60 * 1000;

  const chat = {
    state: { phase: 'idle' },

    async start(config, prompt) {
      chat.state = { phase: 'starting' };
      try {
        const markdown = await run(config, prompt);
        chat.state = { phase: 'done', markdown };
      } catch (err) {
        chat.state = { phase: 'error', error: err.message };
      }
    },
  };
  window.__ytsChat = chat;

  function first(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch { /* invalid selector in config: skip it */ }
    }
    return null;
  }

  function all(selectors, exclude) {
    for (const sel of selectors) {
      let found = [];
      try { found = [...document.querySelectorAll(sel)]; } catch { continue; }
      found = found.filter((el) => !exclude.some((x) => { try { return el.closest(x); } catch { return false; } }));
      if (found.length) return found;
    }
    return [];
  }

  async function waitFor(fn, timeoutMs, intervalMs = 250) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const value = fn();
      if (value) return value;
      await sleep(intervalMs);
    }
    return null;
  }

  const isEnabled = (btn) => btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';

  function insertText(input, text) {
    input.focus();
    if (input instanceof HTMLTextAreaElement) {
      // React-controlled textarea: use the native setter so React sees the change.
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // Rich editors (ProseMirror, Lexical) handle paste events themselves, as one insertion.
    const data = new DataTransfer();
    data.setData('text/plain', text);
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }

  function pressEnter(input) {
    input.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
      }));
    }
  }

  const hasContent = (input) =>
    (input instanceof HTMLTextAreaElement ? input.value : input.innerText).trim().length > 0;

  async function run(config, prompt) {
    const { label, origin } = config;
    const loginRe = new RegExp(config.loginUrlPattern);

    const input = await waitFor(() => first(config.input), 20_000);
    if (!input) {
      if (loginRe.test(location.href)) throw new Error(`Not logged in to ${label}. Log in at ${origin}, then retry.`);
      throw new Error(
        `Couldn't find ${label}'s message box. Make sure you're logged in at ${origin}. ` +
        'If you are, the site layout may have changed; update its selectors in lib/providers.js.'
      );
    }

    const before = all(config.assistantMessage, config.exclude).length;

    chat.state = { phase: 'sending' };
    insertText(input, prompt);
    // Some sites turn a long paste into an attachment, leaving the box empty but the send button enabled.
    const accepted = await waitFor(() => hasContent(input) || isEnabled(first(config.sendButton)), 1500);
    if (!accepted) {
      document.execCommand('insertText', false, prompt);
      if (!(await waitFor(() => hasContent(input), 2000))) {
        throw new Error(`Couldn't paste the transcript into ${label}'s message box.`);
      }
    }

    if (config.submit === 'click') {
      // Attachments may need time to upload before send is enabled.
      const send = await waitFor(() => { const b = first(config.sendButton); return isEnabled(b) && b; }, 60_000);
      if (send) send.click();
      else pressEnter(input);
    } else {
      await sleep(500);
      pressEnter(input);
    }

    chat.state = { phase: 'waiting' };
    const reply = await waitForReply(config, before);
    const markdown = globalThis.ytsHtml2md(reply);
    if (!markdown) throw new Error(`${label} returned an empty reply.`);
    return markdown;
  }

  async function waitForReply(config, before) {
    const end = Date.now() + TIMEOUT_MS;
    let lastText = '';
    let stableSince = Date.now();

    while (Date.now() < end) {
      await sleep(500);
      const messages = all(config.assistantMessage, config.exclude);
      if (messages.length <= before) continue;

      const latest = messages.at(-1);
      const text = latest.innerText.trim();
      if (text !== lastText) {
        lastText = text;
        stableSince = Date.now();
        continue;
      }
      const generating = Boolean(first(config.stopButton));
      if (text && !generating && Date.now() - stableSince >= config.stableMs) return latest;
    }
    throw new Error(`Timed out after 5 minutes waiting for ${config.label}'s reply.`);
  }
})();

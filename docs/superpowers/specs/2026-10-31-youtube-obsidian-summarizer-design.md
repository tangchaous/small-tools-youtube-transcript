# YouTube → LLM → Obsidian Summarizer — Design

Date: 2026-10-31
Status: Draft for review

## Goal

A Chrome extension that, on a YouTube video page, extracts the transcript, summarizes it using the
user's **logged-in web chat subscription** (Claude, ChatGPT, Kimi, or DeepSeek — chosen per run), and
saves a **summary-only** Markdown note into a chosen Obsidian vault and folder via the **Local REST API**
community plugin.

### Decisions (from the user)

- LLM access: logged-in web chat sessions (claude.ai, chatgpt.com, kimi.com, chat.deepseek.com). No API keys.
- Obsidian write path: Local REST API plugin.
- Note content: front matter + summary only (no transcript in the note).
- Vault, folder, and tags are chosen **in the popup** per run.
- Transcript source: the YouTube "Show transcript" panel is the **first choice**; caption-track fetch is the fallback.
- The full transcript is collected and cached first, then sent to the chat **as one whole message** (no chunking, no incremental sending).

### Assumptions

- Manual trigger from the popup; Chrome desktop, loaded unpacked; no Chrome Web Store publishing.
- Plain JavaScript, Manifest V3, no bundler/build step.
- No Python tooling is required, so no virtualenv is created. If Python tooling is added later, use `uv`.

## Architecture

```
manifest.json
background.js            service worker; orchestrates the pipeline
popup/popup.html|js|css  provider, vault, folder, tags, "Summarize & Save", progress
options/options.html|js  vault profiles, prompt template, defaults
content/youtube.js       transcript + metadata extraction (injected on demand)
content/chat.js          generic chat driver: insert prompt, send, wait, scrape
lib/providers.js         per-site selectors/config (the only file to touch when a site changes)
lib/html2md.js           assistant HTML → Markdown
lib/note.js              front matter + note body, filename sanitization
lib/prompt.js            template filling
lib/obsidian.js          Local REST API client (list folders, put note, ping)
tests/*.test.js          node --test unit tests for lib/
```

Permissions: `activeTab`, `scripting`, `storage`, `tabs`; host permissions for `https://www.youtube.com/*`,
the four chat sites, and `http://127.0.0.1/*` / `https://127.0.0.1/*`.

## Components

### Options page (configured once)

- **Vault profiles**: list of `{ name, baseUrl, apiKey }`. The REST plugin serves whichever vault it runs
  in, and each vault's plugin has its own key/port, so a vault is identified by its profile. Default
  `baseUrl` is `http://127.0.0.1:27123` (plugin's non-encrypted server); HTTPS `27124` allowed if the
  user has trusted the plugin's certificate. "Test connection" button per profile.
- **Prompt template** with placeholders `{{title}}`, `{{channel}}`, `{{url}}`, `{{transcript}}`. A sensible
  default is provided.
- **Defaults**: default provider, default tags.

### Popup (per run)

- Provider dropdown: Claude / ChatGPT / Kimi / DeepSeek.
- Vault dropdown (from profiles).
- Folder: text input with suggestions loaded from the selected vault (`GET /vault/` directory listing,
  recursively one or two levels); free text allowed, created implicitly on write.
- Tags: comma/space-separated text input; prefilled with defaults + last used.
- Last-used provider, vault, folder, and tags are remembered in `chrome.storage.local`.
- "Summarize & Save" button, step-by-step status, and final link (`obsidian://open?vault=…&file=…`).
- Popup may close; the pipeline lives in the service worker and stores status in `chrome.storage.session`
  so reopening the popup shows progress/result.

### Transcript extraction (`content/youtube.js`)

1. **Primary — transcript panel**: click the description "Show transcript" button (expanding the
   description first if needed), wait for `ytd-transcript-segment-renderer` elements, wait until the
   segment count stops changing, read `[timestamp, text]` from every segment, then close the panel
   again if we opened it.
2. **Fallback — caption track**: read `captionTracks` from the player response, prefer a manual track in
   the user's UI language, then any manual track, then auto-generated; fetch `baseUrl&fmt=json3` from the
   page context and parse events.
3. Metadata: title, channel, canonical URL, video ID, publish date.

Output: `{ videoId, title, channel, url, published, segments: [{t, text}] }`.

**Caching**: the full result is stored in `chrome.storage.session` keyed by `videoId` before any LLM step,
so retrying (for example with a different provider after a failure) reuses it without re-extracting.

### Summarization (`content/chat.js` + `lib/providers.js`)

- The full transcript is rendered as plain text (one `[mm:ss] text` line per segment) and inserted into
  the prompt template. The entire prompt is sent as **one message** — no chunking.
- Background opens (or reuses) a tab for the provider's new-chat URL, waits for load, and injects `chat.js`
  with that provider's config.
- Insert: focus the input and dispatch a synthetic `paste` event with a `DataTransfer` carrying the whole
  prompt (works for ProseMirror/contenteditable and textarea); fall back to `execCommand('insertText')`.
  Sites that turn large pastes into an attachment (e.g. Claude) are fine — it is still one message.
- Send: click the configured send button once it is enabled.
- Completion: the reply is treated as done when the "stop generating" control is absent **and** the last
  assistant message's text has not changed for ~2 s; overall timeout 5 min.
- Scrape the last assistant message's HTML → `html2md`.
- Provider config shape: `{ id, label, newChatUrl, input, sendButton, stopButton, assistantMessage, loginHint }`
  (CSS selectors, with ordered fallbacks).

### Saving (`lib/obsidian.js`, `lib/note.js`)

- Filename: sanitized video title (strip `\/:*?"<>|#^[]`, collapse whitespace, ≤ 120 chars) + `.md`.
  If it already exists, append ` (2)`, ` (3)`, ….
- `PUT {baseUrl}/vault/{folder}/{filename}` with `Authorization: Bearer {apiKey}`, `Content-Type: text/markdown`.
- Note body:

```markdown
---
title: "…"
channel: "…"
url: https://www.youtube.com/watch?v=…
video_id: …
published: YYYY-MM-DD
summarized_with: Claude
created: YYYY-MM-DDTHH:mm
tags: [youtube, …user tags]
---

<summary markdown>
```

## Error handling

Each stage reports a specific, user-facing message in the popup:

| Stage | Example message |
|---|---|
| Transcript | "This video has no transcript/captions." / "Not a YouTube video page." |
| Chat | "Not logged in to Claude — log in at claude.ai, then retry." / "Couldn't find ChatGPT's input box; the site may have changed (see lib/providers.js)." / "Timed out waiting for the reply." |
| Obsidian | "Obsidian not reachable at http://127.0.0.1:27123 — is Obsidian open with Local REST API enabled?" / "API key rejected (401)." |

On a failure after the summary step, the summary is kept in session storage, and the popup offers
"Retry save" and "Copy summary".

## Testing

- `node --test tests/` for `lib/`: html2md (headings, lists, code, links, tables), note/front matter
  escaping, filename sanitization/dedupe, prompt filling, transcript formatting, json3 parsing.
- Manual checklist (requires the user's logged-in browser): each of the 4 providers end-to-end, video
  with manual captions, auto-captions only, no captions, long (>1 h) video, Obsidian closed, bad key.

## Out of scope

API-key providers, transcript in note, auto-trigger on page load, non-YouTube sites, Web Store packaging.

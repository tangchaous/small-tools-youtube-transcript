# YouTube → LLM → Obsidian Summarizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome MV3 extension: YouTube transcript → summary via logged-in web chat (Claude/ChatGPT/Kimi/DeepSeek) → summary note in an Obsidian vault folder via Local REST API.

**Architecture:** Service worker (`background.js`, ES module) orchestrates a pipeline whose state lives in `chrome.storage.session`. Page work is done by classic scripts injected with `chrome.scripting.executeScript` (`content/youtube.js` in the MAIN world, `content/chat.js` + `lib/html2md.js` in the isolated world). Pure logic lives in `lib/*.js` ES modules, unit-tested with `node --test`.

**Tech Stack:** Plain JavaScript (ES2022), Chrome Manifest V3, Node 26 built-in test runner. No dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-10-31-youtube-obsidian-summarizer-design.md`

## Global Constraints

- Manifest V3, Chrome desktop, loaded unpacked; no bundler, no npm dependencies.
- `package.json` has `"type": "module"`; `lib/*.js` are ES modules except `lib/html2md.js` (classic script, exposes `globalThis.ytsHtml2md`) because it is injected into chat pages.
- Transcript: "Show transcript" panel first, caption-track (`fmt=json3`) fallback; cached in `chrome.storage.session` by `videoId` before any LLM step.
- Whole prompt sent as one message; no chunking.
- Vault, folder, tags chosen in popup; vault profiles `{ name, baseUrl, apiKey }` configured in options. Default baseUrl `http://127.0.0.1:27123`.
- Note = YAML front matter + summary only. Filename ≤ 120 chars, strip `\/:*?"<>|#^[]`, dedupe with ` (2)`, ` (3)`.
- Reply complete when stop control absent AND last assistant text unchanged for `stableMs` (default 2000); overall timeout 5 min.

## Review Focus

1. Titles containing quotes, colons, `#`, emoji → front matter must stay valid YAML and filename must be legal (note.test.js).
2. Tags typed as `#ai, ml  ai` or with spaces/empties → normalized, deduped, `#` stripped, `youtube` always present (note.test.js).
3. Folder typed as `/Inbox/YouTube/` or empty → no double/leading slashes in the REST path; empty = vault root (obsidian.test.js).
4. A note with the same title already exists → saved as `Title (2).md`, never overwritten (obsidian.test.js).
5. Very long transcript (>1 h) → formatted as one string, prompt filled once, no truncation (transcript/prompt tests).

---

### Task 1: Scaffold, prompt + transcript helpers

**Files:** Create `package.json`, `.gitignore`, `lib/prompt.js`, `lib/transcript.js`, `tests/prompt.test.js`, `tests/transcript.test.js`

**Interfaces — Produces:**
- `fillTemplate(template: string, vars: Record<string,string>): string` — replaces `{{key}}`; unknown keys left as-is.
- `DEFAULT_PROMPT: string`
- `formatTimestamp(seconds: number): string` → `m:ss` or `h:mm:ss`
- `formatTranscript(segments: {t:number,text:string}[]): string` → `[m:ss] text` lines
- `parseJson3(json: object): {t,text}[]`
- `parseTimestamp(label: string): number` (`"1:02:03"` → 3723)

- [ ] Step 1: write tests (see `tests/prompt.test.js`, `tests/transcript.test.js`): template substitution incl. `$&` in values and repeated keys; timestamps 0, 59, 61, 3723; json3 events with `segs`, skipping events without segs and newline-only text; 2000-segment transcript yields 2000 lines.
- [ ] Step 2: `npm test` → FAIL (modules missing)
- [ ] Step 3: implement
- [ ] Step 4: `npm test` → PASS
- [ ] Step 5: commit `feat: prompt and transcript helpers`

### Task 2: Note building

**Files:** Create `lib/note.js`, `tests/note.test.js`

**Interfaces — Produces:**
- `sanitizeFilename(title: string): string`
- `normalizeTags(input: string | string[]): string[]` — always includes `youtube`, strips `#`, spaces→`-`, dedupes, lowercases nothing else.
- `buildNote({ meta:{title,channel,url,videoId,published}, provider: string, tags: string[], summary: string, now: Date }): string`

- [ ] Steps: failing tests (quotes/colons in title YAML-escaped via JSON string quoting; tags normalization; date formatting; summary trimmed) → implement → pass → commit `feat: note builder`.

### Task 3: HTML → Markdown

**Files:** Create `lib/html2md.js` (classic script), `tests/html2md.test.js` (builds fake DOM nodes with `nodeType`, `nodeName`, `childNodes`, `nodeValue`, `getAttribute`)

**Interfaces — Produces:** `globalThis.ytsHtml2md(node): string` — handles p, br, h1–h6, strong/b, em/i, code, pre, ul/ol (nested), li, a, blockquote, hr, table; ignores button/svg/style/script.

- [ ] Steps: failing tests → implement → pass → commit `feat: html to markdown converter`.

### Task 4: Obsidian REST client

**Files:** Create `lib/obsidian.js`, `tests/obsidian.test.js` (inject a fake `fetch`)

**Interfaces — Produces:**
- `notePath(folder: string, filename: string): string` (encoded per segment, `vault/` prefix not included)
- `class ObsidianClient({ baseUrl, apiKey, fetch })` with `ping(): Promise<{ok, authenticated}>`, `listFolders(depth=2): Promise<string[]>`, `exists(path): Promise<boolean>`, `putNote(folder, filename, body): Promise<string /*final vault path*/>` (dedupes), errors are `ObsidianError` with user-facing `message`.

- [ ] Steps: failing tests (folder slash normalization, dedupe to `(2)`, 401 message, network failure message, listFolders recursion) → implement → pass → commit `feat: obsidian REST client`.

### Task 5: Providers + chat driver

**Files:** Create `lib/providers.js` (ES module, JSON-serializable configs), `content/chat.js` (classic; defines `window.__ytsChat.start(config, prompt)` and `window.__ytsChat.state`)

**Interfaces — Produces:** `PROVIDERS: Record<'claude'|'chatgpt'|'kimi'|'deepseek', {id,label,newChatUrl,origin,input[],sendButton[],stopButton[],assistantMessage[],loginUrlPattern,stableMs}>`; chat state `{ phase:'starting'|'sending'|'waiting'|'done'|'error', markdown?, error? }`.

- [ ] Steps: implement; `tests/providers.test.js` asserts every provider has all required keys with non-empty selector arrays and an https URL → commit `feat: provider configs and chat driver`.

### Task 6: YouTube extraction

**Files:** Create `content/youtube.js` (MAIN world; defines `window.__ytsYoutube.extract(): Promise<{meta, segments?, json3?, error?}>`)

- [ ] Steps: implement panel-first (click "Show transcript", fallback set panel visibility attribute, wait until segment count stable 1.5 s, max 20 s), then caption-track fallback via `#movie_player.getPlayerResponse()` → commit `feat: youtube transcript extraction`.

### Task 7: Background pipeline + manifest

**Files:** Create `manifest.json`, `background.js`, `lib/storage.js`

- [ ] Steps: message `{type:'run', provider, vaultName, folder, tags}` → stages `transcript → chat → save`, status written to `chrome.storage.session.job`; chat polled every 1.5 s via `executeScript` (keeps SW alive); `{type:'retrySave'}` re-runs save from cached summary → commit `feat: background pipeline`.

### Task 8: Options page

**Files:** Create `options/options.html`, `options/options.js`, `options/options.css`
- [ ] Steps: vault profile CRUD + Test connection, prompt template (reset to default), default provider and tags → commit `feat: options page`.

### Task 9: Popup

**Files:** Create `popup/popup.html`, `popup/popup.js`, `popup/popup.css`
- [ ] Steps: provider/vault/folder (datalist from `listFolders`)/tags, remembered in `chrome.storage.local`; Summarize & Save; live status from `storage.session` changes; Retry save / Copy summary / Open in Obsidian → commit `feat: popup`.

### Task 10: README + manual test checklist, verification

**Files:** Create `README.md`
- [ ] Steps: setup (Local REST API plugin, HTTP server, profile name = vault name), loading unpacked, troubleshooting selectors; run `npm test`, validate manifest JSON, `node --check` every JS file → commit `docs: README`.

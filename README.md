# YouTube → Obsidian Summarizer

A Chrome extension that takes the transcript of the YouTube video you're watching, summarizes it with
**your logged-in web chat** (Claude, ChatGPT, Kimi, or DeepSeek; no API keys), and saves the summary as a
note in the Obsidian vault and folder you pick.

```
YouTube tab ──transcript──▶ hidden chat window (claude.ai / chatgpt.com / kimi.com / chat.deepseek.com)
                                  │ one message: prompt + whole transcript
                                  ▼
                           summary (Markdown) ──Local REST API──▶ Obsidian: <folder>/<Video title>.md
```

## Setup

### 1. Obsidian: Local REST API plugin

In each vault you want to save to:

1. **Settings → Community plugins → Browse**, then install and enable **Local REST API**.
2. In the plugin's settings, turn on **Enable Non-encrypted (HTTP) Server** (port `27123`).
   Alternatively, keep HTTPS (`27124`) and trust the plugin's certificate in your OS keychain.
3. Copy the **API Key**.

The plugin serves whichever vault it runs in. **If you keep several vaults open at once, give each one a
different port** (for example 27123 and 27125). Otherwise only the first vault opened gets the port, and
saves to the other vault fail with "rejected the API key". The options page warns when two vaults share a port.

### 2. Load the extension

1. Open `chrome://extensions`, then turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension, then right-click it and choose **Options**.
4. Add a vault: **name** (same as the Obsidian vault name, which makes "Open in Obsidian" work), **URL**
   (`http://127.0.0.1:27123`), and **API key**. Click **Test connection**, then **Save**.
5. Optionally edit the default provider, the default tags, and the summary prompt.

### 3. Log in to the chat sites

Log in to whichever of claude.ai, chatgpt.com, kimi.com, and chat.deepseek.com you plan to use.

## Use

1. Open a YouTube video (`youtube.com/watch?v=…`).
2. Click the extension icon, then choose the **provider**, **vault**, **folder** (existing folders are
   suggested; new ones are created), and **tags**.
3. Click **Summarize & Save**.

What happens:

- The transcript is read from YouTube's **Show transcript** panel, falling back to the caption track.
  It is collected in full and cached for the browser session, so retries skip this step.
- A new chat opens in a **minimized window** that you don't see, using your logged-in session. The prompt
  plus the **entire transcript** is pasted as one message and sent. When the reply finishes, it's converted to
  Markdown and the window closes itself. If something needs your attention (a login page, an error), that
  window comes to the front instead. The conversation also remains in that site's chat history.
- The note `<folder>/<Video title>.md` is created. If that name exists, `(2)`, `(3)`, … is appended,
  so existing notes are never overwritten.

The popup can be closed at any time. Reopen it to see progress. If saving fails, you can **Retry save**
(optionally with a different vault or folder) or **Copy summary**.

### Note format

```markdown
---
title: "Video title"
channel: "Channel"
url: "https://www.youtube.com/watch?v=…"
video_id: "…"
published: 2026-10-30
summarized_with: "Claude"
created: 2026-10-31T09:15
tags:
  - youtube
  - your-tags
---

## TL;DR
…
```

## Troubleshooting

| Message | What to do |
|---|---|
| *Obsidian not reachable at …* | Open Obsidian, enable the plugin and its HTTP server, and check the URL/port. |
| *… rejected the API key* | Usually two open vaults share a port, so a different vault answered. Give each vault its own port. Otherwise, re-copy the key. |
| *Not logged in to …* / *Couldn't find …'s message box* | Log in to that site in this Chrome profile. If you are logged in, the site's layout changed (see below). |
| *This video has no transcript or captions available* | The video has no captions; nothing to summarize. |
| *Timed out waiting for …'s reply* | Very long videos on slow models can exceed 5 minutes. Retry, or pick a faster model in that site's UI. |

### When a chat site changes its layout

All site-specific selectors live in [`lib/providers.js`](lib/providers.js): the message box, send button,
"still generating" indicator, and reply container, each with ordered fallbacks. Open the site, inspect the
element with DevTools, add a matching selector at the front of the right list, and reload the extension at
`chrome://extensions`.

## Development

No dependencies and no build step. The unit tests cover prompt filling, transcript parsing, the note/front
matter builder, HTML→Markdown, the Obsidian client, and provider configs:

```sh
npm test        # node --test tests/
```

| Path | Purpose |
|---|---|
| `background.js` | Service worker that runs transcript → chat → save; state lives in `chrome.storage.session` |
| `content/youtube.js` | Injected into YouTube (MAIN world): transcript panel, then caption-track fallback |
| `content/chat.js` | Injected into the chat site: paste, send, wait for the reply to finish, scrape it |
| `lib/providers.js` | Per-site selectors |
| `lib/html2md.js` | Reply HTML → Markdown (classic script, injected with `chat.js`) |
| `lib/note.js`, `lib/obsidian.js`, `lib/prompt.js`, `lib/transcript.js`, `lib/storage.js` | Pure logic and storage helpers |

### Manual test checklist

Run these in your browser, since they need your logged-in sessions:

- [ ] Each provider end-to-end: Claude, ChatGPT, Kimi, DeepSeek
- [ ] Video with manual captions; video with auto-generated captions only; video with no captions
- [ ] Long (>1 h) video
- [ ] Obsidian closed → clear error → open Obsidian → **Retry save** works
- [ ] Wrong API key → "rejected" message
- [ ] Same video saved twice → `Title (2).md`

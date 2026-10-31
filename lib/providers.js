// Per-site configuration for driving each chat web app.
// When a provider changes its UI, this is the only file that should need edits.
// Each selector list is tried in order; the first match wins.
//
//   input            message box (textarea or contenteditable)
//   submit           'click' the send button, or press 'enter' in the input
//   sendButton       send button (used when submit === 'click', and as a fallback)
//   stopButton       anything present only while a reply is still generating
//   assistantMessage container of one assistant reply (last match = newest reply)
//   exclude          assistantMessage matches inside these are ignored (e.g. "thinking" blocks)
//   loginUrlPattern  regex source; a match on location.href means "not logged in"
//   stableMs         reply is done when text is unchanged this long (and no stopButton);
//                    use ≥ 5000 when there is no stopButton, so a mid-stream pause isn't taken as done

export const PROVIDERS = {
  claude: {
    id: 'claude',
    label: 'Claude',
    origin: 'https://claude.ai',
    newChatUrl: 'https://claude.ai/new',
    input: ['div.ProseMirror[contenteditable="true"]', '[contenteditable="true"][role="textbox"]', 'fieldset [contenteditable="true"]'],
    submit: 'click',
    sendButton: ['button[aria-label="Send message"]', 'button[aria-label="Send Message"]', 'fieldset button[type="submit"]'],
    stopButton: ['button[aria-label="Stop response"]', '[data-is-streaming="true"]'],
    assistantMessage: ['.font-claude-response', '.font-claude-message', '[data-is-streaming] .standard-markdown'],
    exclude: [],
    loginUrlPattern: '/login',
    stableMs: 2000,
  },
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    origin: 'https://chatgpt.com',
    newChatUrl: 'https://chatgpt.com/',
    input: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea[name="prompt-textarea"]'],
    submit: 'click',
    sendButton: ['button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label="Send prompt"]'],
    stopButton: ['button[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]'],
    assistantMessage: ['[data-message-author-role="assistant"] .markdown', '[data-message-author-role="assistant"]'],
    exclude: [],
    loginUrlPattern: '/auth/|auth\\.openai\\.com',
    stableMs: 2000,
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi',
    origin: 'https://www.kimi.com',
    newChatUrl: 'https://www.kimi.com/',
    input: ['.chat-input-editor[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]'],
    submit: 'click',
    sendButton: ['.send-button-container:not(.disabled) .send-button', 'button[aria-label*="Send" i]'],
    stopButton: ['.send-button-container.stop', '.stop-message-btn', 'button[aria-label*="Stop" i]'],
    assistantMessage: ['.segment-assistant .markdown', '.chat-content-item-assistant .markdown', '.markdown-container .markdown'],
    exclude: ['.thinking-container', '.toolcall-container'],
    loginUrlPattern: '/login',
    stableMs: 3000,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    origin: 'https://chat.deepseek.com',
    newChatUrl: 'https://chat.deepseek.com/',
    input: ['textarea#chat-input', 'textarea[placeholder]', 'textarea'],
    // DeepSeek's send control is an unlabeled div; Enter is the reliable submit.
    submit: 'enter',
    sendButton: [],
    stopButton: [],
    assistantMessage: ['.ds-markdown'],
    exclude: ['.ds-think-content', '[class*="think"]'],
    loginUrlPattern: '/sign_in|/login',
    stableMs: 5000,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

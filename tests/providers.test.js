import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, PROVIDER_IDS } from '../lib/providers.js';

test('exactly the four requested providers, in display order', () => {
  assert.deepEqual(PROVIDER_IDS, ['claude', 'chatgpt', 'kimi', 'deepseek']);
});

for (const id of ['claude', 'chatgpt', 'kimi', 'deepseek']) {
  test(`${id} config is complete and serializable`, () => {
    const p = PROVIDERS[id];
    assert.equal(p.id, id);
    assert.ok(p.label);
    assert.match(p.newChatUrl, /^https:\/\//);
    assert.ok(p.newChatUrl.startsWith(p.origin));
    for (const key of ['input', 'assistantMessage']) {
      assert.ok(Array.isArray(p[key]) && p[key].length > 0, `${id}.${key}`);
    }
    assert.ok(['click', 'enter'].includes(p.submit));
    if (p.submit === 'click') assert.ok(p.sendButton.length > 0, `${id}.sendButton`);
    assert.ok(Array.isArray(p.stopButton) && Array.isArray(p.exclude));
    assert.ok(p.stableMs >= 1000);
    assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
  });
}

test('kimi send button selectors never match a disabled send button', () => {
  for (const sel of PROVIDERS.kimi.sendButton) assert.match(sel, /:not\(\.disabled\)|\[aria-label/);
});

test('providers without a stop indicator wait longer before treating a reply as done', () => {
  for (const p of Object.values(PROVIDERS)) {
    if (!p.stopButton.length) assert.ok(p.stableMs >= 5000, `${p.id}.stableMs`);
  }
});

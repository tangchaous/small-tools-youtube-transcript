import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplate, DEFAULT_PROMPT } from '../lib/prompt.js';

test('fillTemplate replaces every occurrence of each key', () => {
  assert.equal(fillTemplate('{{a}} and {{a}} / {{b}}', { a: 'x', b: 'y' }), 'x and x / y');
});

test('fillTemplate inserts values literally (no $& expansion)', () => {
  assert.equal(fillTemplate('T: {{t}}', { t: 'costs $& $1' }), 'T: costs $& $1');
});

test('fillTemplate leaves unknown placeholders untouched', () => {
  assert.equal(fillTemplate('{{x}} {{y}}', { x: '1' }), '1 {{y}}');
});

test('fillTemplate tolerates whitespace inside braces', () => {
  assert.equal(fillTemplate('{{ title }}', { title: 'Hi' }), 'Hi');
});

test('DEFAULT_PROMPT contains the transcript placeholder exactly once', () => {
  assert.equal(DEFAULT_PROMPT.match(/\{\{transcript\}\}/g).length, 1);
});

test('fillTemplate keeps a very long transcript intact', () => {
  const transcript = 'word '.repeat(200_000);
  const out = fillTemplate(DEFAULT_PROMPT, { transcript, title: 't', channel: 'c', url: 'u' });
  assert.ok(out.includes(transcript));
});

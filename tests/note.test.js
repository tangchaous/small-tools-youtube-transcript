import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFilename, normalizeTags, buildNote, formatLocalDateTime } from '../lib/note.js';

test('sanitizeFilename strips characters Obsidian/filesystems reject', () => {
  assert.equal(sanitizeFilename('What is AI? A/B: "test" #1 [draft] ^x |y <z>*'), 'What is AI AB test 1 draft x y z');
});

test('sanitizeFilename keeps emoji and unicode, collapses whitespace', () => {
  assert.equal(sanitizeFilename('  🚀  Ünïcode   title  '), '🚀 Ünïcode title');
});

test('sanitizeFilename caps length at 120 and never ends with a dot or space', () => {
  const out = sanitizeFilename('a'.repeat(119) + ' . bbb');
  assert.ok(out.length <= 120);
  assert.ok(!/[ .]$/.test(out));
});

test('sanitizeFilename falls back for empty titles', () => {
  assert.equal(sanitizeFilename('???'), 'Untitled video');
});

test('normalizeTags: strips #, dedupes, hyphenates spaces, always includes youtube first', () => {
  assert.deepEqual(normalizeTags('#ai, ml, ai,,  machine learning'), ['youtube', 'ai', 'ml', 'machine-learning']);
});

test('normalizeTags accepts arrays and empty input', () => {
  assert.deepEqual(normalizeTags(['#YouTube', 'x']), ['youtube', 'x']);
  assert.deepEqual(normalizeTags(''), ['youtube']);
});

test('normalizeTags splits on commas only when present, otherwise on whitespace', () => {
  assert.deepEqual(normalizeTags('ai ml'), ['youtube', 'ai', 'ml']);
});

test('formatLocalDateTime', () => {
  assert.equal(formatLocalDateTime(new Date(2026, 9, 31, 7, 5)), '2026-10-31T07:05');
});

test('buildNote produces valid front matter with escaped strings and the summary', () => {
  const note = buildNote({
    meta: {
      title: 'He said: "hi" #1',
      channel: 'Chan\\nel',
      url: 'https://www.youtube.com/watch?v=abc',
      videoId: 'abc',
      published: '2026-01-02',
    },
    provider: 'Claude',
    tags: ['youtube', 'ai'],
    summary: '\n\n## TL;DR\nStuff.\n\n',
    now: new Date(2026, 9, 31, 7, 5),
  });
  assert.equal(
    note,
    [
      '---',
      'title: "He said: \\"hi\\" #1"',
      'channel: "Chan\\\\nel"',
      'url: "https://www.youtube.com/watch?v=abc"',
      'video_id: "abc"',
      'published: 2026-01-02',
      'summarized_with: "Claude"',
      'created: 2026-10-31T07:05',
      'tags:',
      '  - youtube',
      '  - ai',
      '---',
      '',
      '## TL;DR',
      'Stuff.',
      '',
    ].join('\n')
  );
});

test('buildNote omits published when unknown', () => {
  const note = buildNote({
    meta: { title: 't', channel: '', url: 'u', videoId: 'v', published: '' },
    provider: 'Kimi', tags: ['youtube'], summary: 's', now: new Date(2026, 0, 1),
  });
  assert.ok(!note.includes('published:'));
});

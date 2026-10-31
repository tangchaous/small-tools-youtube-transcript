import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTimestamp, parseTimestamp, formatTranscript, parseJson3 } from '../lib/transcript.js';

test('formatTimestamp', () => {
  assert.equal(formatTimestamp(0), '0:00');
  assert.equal(formatTimestamp(59.9), '0:59');
  assert.equal(formatTimestamp(61), '1:01');
  assert.equal(formatTimestamp(3723), '1:02:03');
});

test('parseTimestamp', () => {
  assert.equal(parseTimestamp('0:05'), 5);
  assert.equal(parseTimestamp('12:34'), 754);
  assert.equal(parseTimestamp('1:02:03'), 3723);
  assert.equal(parseTimestamp(' 2:00 '), 120);
  assert.equal(parseTimestamp('garbage'), 0);
});

test('formatTranscript renders one [m:ss] line per segment, collapsing whitespace', () => {
  const out = formatTranscript([
    { t: 0, text: 'hello\n world' },
    { t: 65, text: '  next  ' },
  ]);
  assert.equal(out, '[0:00] hello world\n[1:05] next');
});

test('formatTranscript skips empty segments', () => {
  assert.equal(formatTranscript([{ t: 1, text: '   ' }, { t: 2, text: 'a' }]), '[0:02] a');
});

test('formatTranscript handles >1h transcripts without truncation', () => {
  const segs = Array.from({ length: 2000 }, (_, i) => ({ t: i * 3, text: `line ${i}` }));
  const lines = formatTranscript(segs).split('\n');
  assert.equal(lines.length, 2000);
  assert.equal(lines.at(-1), '[1:39:57] line 1999');
});

test('parseJson3 joins segs and skips events without text', () => {
  const json = {
    events: [
      { tStartMs: 0, dDurationMs: 1000 },
      { tStartMs: 1500, segs: [{ utf8: 'Hello' }, { utf8: ' there' }] },
      { tStartMs: 3000, segs: [{ utf8: '\n' }] },
      { tStartMs: 62000, segs: [{ utf8: 'world' }] },
    ],
  };
  assert.deepEqual(parseJson3(json), [
    { t: 1.5, text: 'Hello there' },
    { t: 62, text: 'world' },
  ]);
});

test('parseJson3 tolerates missing events', () => {
  assert.deepEqual(parseJson3({}), []);
});

// Transcript formatting and parsing helpers.

export function formatTimestamp(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function parseTimestamp(label) {
  const parts = String(label).trim().split(':').map(Number);
  if (parts.length < 2 || parts.some(Number.isNaN)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function formatTranscript(segments) {
  return segments
    .map(({ t, text }) => ({ t, text: String(text).replace(/\s+/g, ' ').trim() }))
    .filter(({ text }) => text)
    .map(({ t, text }) => `[${formatTimestamp(t)}] ${text}`)
    .join('\n');
}

// YouTube timedtext `fmt=json3` → segments.
export function parseJson3(json) {
  return (json.events ?? [])
    .filter((e) => e.segs)
    .map((e) => ({
      t: (e.tStartMs ?? 0) / 1000,
      text: e.segs.map((s) => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim(),
    }))
    .filter((s) => s.text);
}

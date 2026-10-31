// Builds the Obsidian note (YAML front matter + summary) and its filename.

const MAX_FILENAME = 120;

export function sanitizeFilename(title) {
  let name = String(title)
    .replace(/[\\/:*?"<>|#^[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length > MAX_FILENAME) name = name.slice(0, MAX_FILENAME);
  name = name.replace(/[ .]+$/, '');
  return name || 'Untitled video';
}

export function normalizeTags(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input ?? '').split(String(input ?? '').includes(',') ? ',' : /\s+/);
  const tags = raw
    .map((t) => String(t).trim().replace(/^#+/, '').trim().replace(/\s+/g, '-').toLowerCase())
    .filter(Boolean);
  return [...new Set(['youtube', ...tags])];
}

export function formatLocalDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// JSON string syntax is valid YAML double-quoted scalar syntax.
const yamlString = (value) => JSON.stringify(String(value ?? ''));

export function buildNote({ meta, provider, tags, summary, now = new Date() }) {
  const lines = [
    '---',
    `title: ${yamlString(meta.title)}`,
    `channel: ${yamlString(meta.channel)}`,
    `url: ${yamlString(meta.url)}`,
    `video_id: ${yamlString(meta.videoId)}`,
  ];
  if (/^\d{4}-\d{2}-\d{2}$/.test(meta.published ?? '')) lines.push(`published: ${meta.published}`);
  lines.push(
    `summarized_with: ${yamlString(provider)}`,
    `created: ${formatLocalDateTime(now)}`,
    'tags:',
    ...tags.map((t) => `  - ${t}`),
    '---',
    '',
    String(summary).trim(),
    ''
  );
  return lines.join('\n');
}

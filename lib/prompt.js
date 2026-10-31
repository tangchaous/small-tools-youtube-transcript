// Prompt template filling. Placeholders look like {{name}}.

export const DEFAULT_PROMPT = `Summarize the following YouTube video transcript for my Obsidian notes.

Video: {{title}}
Channel: {{channel}}
URL: {{url}}

Write the summary in Markdown using exactly these sections:

## TL;DR
Two or three sentences.

## Key points
A bulleted list of the main ideas, in the order they appear.

## Notable details
Specific facts, numbers, examples, or quotes, each with its [m:ss] timestamp.

## Takeaways
Actionable or memorable conclusions.

Reply with the summary only: no preamble and no closing remarks.

Transcript:
{{transcript}}`;

export function fillTemplate(template, vars) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    Object.hasOwn(vars, key) ? String(vars[key]) : match
  );
}

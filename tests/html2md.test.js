import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../lib/html2md.js';

const html2md = globalThis.ytsHtml2md;

// Minimal DOM stand-ins: only the properties html2md reads.
const t = (text) => ({ nodeType: 3, nodeName: '#text', nodeValue: text, childNodes: [] });
const h = (tag, attrs = {}, ...children) => ({
  nodeType: 1,
  nodeName: tag.toUpperCase(),
  childNodes: children.map((c) => (typeof c === 'string' ? t(c) : c)),
  getAttribute: (name) => attrs[name] ?? null,
});
const root = (...children) => h('div', {}, ...children);

test('paragraphs, headings, inline formatting', () => {
  const md = html2md(root(
    h('h2', {}, 'TL;DR'),
    h('p', {}, 'This is ', h('strong', {}, 'bold'), ', ', h('em', {}, 'italic'), ' and ', h('code', {}, 'x()'), '.'),
    h('p', {}, 'Second', h('br'), 'line')
  ));
  assert.equal(md, '## TL;DR\n\nThis is **bold**, *italic* and `x()`.\n\nSecond\nline');
});

test('nested unordered and ordered lists', () => {
  const md = html2md(root(
    h('ul', {},
      h('li', {}, 'one'),
      h('li', {}, h('p', {}, 'two'), h('ol', {}, h('li', {}, 'a'), h('li', {}, 'b')))
    )
  ));
  assert.equal(md, '- one\n- two\n  1. a\n  2. b');
});

test('links, blockquote, hr', () => {
  const md = html2md(root(
    h('p', {}, h('a', { href: 'https://x.y' }, 'site')),
    h('blockquote', {}, h('p', {}, 'quoted'), h('p', {}, 'more')),
    h('hr')
  ));
  assert.equal(md, '[site](https://x.y)\n\n> quoted\n>\n> more\n\n---');
});

test('pre/code keeps language and raw text', () => {
  const md = html2md(root(h('pre', {}, h('code', { class: 'language-js' }, 'const a = 1;\nfoo();'))));
  assert.equal(md, '```js\nconst a = 1;\nfoo();\n```');
});

test('tables', () => {
  const md = html2md(root(h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'A'), h('th', {}, 'B'))),
    h('tbody', {}, h('tr', {}, h('td', {}, '1'), h('td', {}, 'x|y')))
  )));
  assert.equal(md, '| A | B |\n| --- | --- |\n| 1 | x\\|y |');
});

test('ignores UI chrome (buttons, svg, style)', () => {
  const md = html2md(root(h('p', {}, 'keep'), h('button', {}, 'Copy'), h('svg', {}, 'x'), h('style', {}, 'p{}')));
  assert.equal(md, 'keep');
});

test('collapses source whitespace in text nodes', () => {
  assert.equal(html2md(root(h('p', {}, '  lots   of\n  space '))), 'lots of space');
});

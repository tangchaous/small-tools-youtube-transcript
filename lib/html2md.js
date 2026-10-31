// Converts a rendered chat reply (DOM subtree) to Markdown.
// Classic script (not a module): it is injected into chat pages, and it only reads
// nodeType / nodeName / childNodes / nodeValue / getAttribute so it can be unit-tested
// without a DOM. Exposes globalThis.ytsHtml2md(node) → string.
(() => {
  const SKIP = new Set(['BUTTON', 'SVG', 'STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE', 'INPUT', 'TEXTAREA']);
  const CONTAINERS = new Set([
    'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'UL', 'OL', 'LI', 'BLOCKQUOTE',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR',
  ]);

  const tagOf = (node) => String(node.nodeName).toUpperCase();
  const kids = (node) => Array.from(node.childNodes ?? []);

  function rawText(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1 || SKIP.has(tagOf(node))) return '';
    return kids(node).map(rawText).join('');
  }

  function find(node, tag) {
    for (const child of kids(node)) {
      if (child.nodeType !== 1) continue;
      if (tagOf(child) === tag) return child;
      const hit = find(child, tag);
      if (hit) return hit;
    }
    return null;
  }

  function children(node) {
    const container = CONTAINERS.has(tagOf(node));
    return kids(node)
      .filter((c) => !(container && c.nodeType === 3 && !c.nodeValue.trim()))
      .map(render)
      .join('');
  }

  // Inline content of a leaf block: drop spaces that follow hard line breaks.
  const inline = (node) => children(node).replace(/\n +/g, '\n').trim();
  const block = (s) => `\n\n${s}\n\n`;

  function list(node, ordered) {
    let n = 0;
    const items = kids(node)
      .filter((c) => c.nodeType === 1 && tagOf(c) === 'LI')
      .map((li) => {
        const marker = ordered ? `${++n}. ` : '- ';
        const lines = children(li).trim().replace(/\n{2,}/g, '\n').split('\n');
        const pad = ' '.repeat(marker.length);
        return marker + lines[0] + lines.slice(1).map((l) => `\n${l ? pad + l : ''}`).join('');
      });
    return block(items.join('\n'));
  }

  function table(node) {
    const rows = [];
    (function collect(n) {
      for (const c of kids(n)) {
        if (c.nodeType !== 1) continue;
        if (tagOf(c) === 'TR') rows.push(c);
        else collect(c);
      }
    })(node);
    if (!rows.length) return '';
    const cells = rows.map((tr) =>
      kids(tr)
        .filter((c) => c.nodeType === 1 && ['TD', 'TH'].includes(tagOf(c)))
        .map((c) => inline(c).replace(/\n/g, ' ').replace(/\|/g, '\\|'))
    );
    const line = (r) => `| ${r.join(' | ')} |`;
    return block([line(cells[0]), line(cells[0].map(() => '---')), ...cells.slice(1).map(line)].join('\n'));
  }

  function render(node) {
    if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';
    const tag = tagOf(node);
    if (SKIP.has(tag)) return '';
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) return block(`${'#'.repeat(Number(heading[1]))} ${inline(node)}`);
    switch (tag) {
      case 'P': return block(inline(node));
      case 'BR': return '\n';
      case 'HR': return block('---');
      case 'STRONG': case 'B': { const s = children(node).trim(); return s ? `**${s}**` : ''; }
      case 'EM': case 'I': { const s = children(node).trim(); return s ? `*${s}*` : ''; }
      case 'DEL': case 'S': { const s = children(node).trim(); return s ? `~~${s}~~` : ''; }
      case 'CODE': {
        const s = rawText(node);
        return s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``;
      }
      case 'PRE': {
        const code = find(node, 'CODE') ?? node;
        const cls = `${code.getAttribute?.('class') ?? ''} ${node.getAttribute?.('class') ?? ''}`;
        const lang = /language-([\w+#-]+)/.exec(cls)?.[1] ?? '';
        return block(`\`\`\`${lang}\n${rawText(code).replace(/\n$/, '')}\n\`\`\``);
      }
      case 'A': {
        const text = children(node).trim();
        const href = node.getAttribute?.('href');
        return href && text ? `[${text}](${href})` : text;
      }
      case 'UL': return list(node, false);
      case 'OL': return list(node, true);
      case 'BLOCKQUOTE': {
        const inner = finish(children(node));
        return block(inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n'));
      }
      case 'TABLE': return table(node);
      default:
        return CONTAINERS.has(tag) ? block(children(node)) : children(node);
    }
  }

  function finish(md) {
    return md.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  globalThis.ytsHtml2md = (node) => finish(render(node));
})();

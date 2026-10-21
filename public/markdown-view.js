// A deliberately small Markdown renderer. No raw HTML is parsed, and all user/model
// text enters the DOM through textContent/text nodes. Links allow only HTTP(S).
export function safeLink(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function inline(target, text) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    target.append(document.createTextNode(text.slice(last, match.index)));
    const token = match[0];
    if (token.startsWith('`')) {
      const code = document.createElement('code'); code.textContent = token.slice(1, -1); target.append(code);
    } else if (token.startsWith('**')) {
      const strong = document.createElement('strong'); strong.textContent = token.slice(2, -2); target.append(strong);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((.+)\)$/);
      const href = safeLink(link[2]);
      if (href) {
        const a = document.createElement('a'); a.textContent = link[1]; a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; target.append(a);
      } else target.append(document.createTextNode(token));
    }
    last = match.index + token.length;
  }
  target.append(document.createTextNode(text.slice(last)));
}
export function renderMarkdown(markdown, target) {
  target.replaceChildren();
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^(`{3,})([\w+-]*)\s*$/);
    if (fence) {
      const contents = []; i++;
      while (i < lines.length && lines[i] !== fence[1]) contents.push(lines[i++]);
      i++;
      const pre = document.createElement('pre'), code = document.createElement('code');
      code.textContent = contents.join('\n'); pre.append(code); target.append(pre); continue;
    }
    const heading = line.match(/^(#{1,3}) (.+)$/);
    if (heading) { const h = document.createElement(`h${heading[1].length}`); inline(h, heading[2]); target.append(h); i++; continue; }
    if (line.startsWith('> ')) {
      const block = document.createElement('blockquote'), text = [];
      while (i < lines.length && /^>(?: |$)/.test(lines[i])) text.push(lines[i++].replace(/^> ?/, ''));
      inline(block, text.join('\n')); target.append(block); continue;
    }
    if (/^- /.test(line)) {
      const ul = document.createElement('ul');
      while (i < lines.length && /^- /.test(lines[i])) { const li = document.createElement('li'); inline(li, lines[i++].slice(2)); ul.append(li); }
      target.append(ul); continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && (paragraph.length === 0 || !/^(?:#{1,3} |`{3,}|> |- )/.test(lines[i]))) paragraph.push(lines[i++]);
    const p = document.createElement('p');
    if (/\bSource s\d+|\be\d{4}\s*·/.test(paragraph.join(' '))) p.className = 'source-anchor';
    inline(p, paragraph.join('\n')); target.append(p);
  }
}

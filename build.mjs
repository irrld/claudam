// Renders book/*.md into a static site in dist/.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dirname;
const bookDir = join(root, 'book');
const siteDir = join(root, 'site');
const outDir = join(root, 'dist');

const escapeHtml = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Bold, italic, and a run of bare [label]s as feedback pills.
const inline = (s) =>
  escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\](?!\()/g, '<button type="button" class="pill" data-feedback="$1">$1</button>')
    .replace(/(?:\s*<button type="button" class="pill"[^>]*>[^<]*<\/button>)+/g, (run) => `<span class="pills">${run.trim()}</span>`);

// Splits Markdown into heading, paragraph and list blocks.
function parse(md) {
  const blocks = [];
  let open = null;
  for (const line of md.split('\n')) {
    let m;
    if (!line.trim()) {
      open = null;
    } else if ((m = line.match(/^(#{1,6})\s+(.*)/))) {
      blocks.push({ type: 'heading', level: m[1].length, text: m[2] });
      open = null;
    } else if ((m = line.match(/^(\d+)\.\s+(.*)/))) {
      if (open?.type !== 'ol') blocks.push((open = { type: 'ol', items: [] }));
      open.items.push({ n: Number(m[1]), text: m[2] });
    } else if ((m = line.match(/^-\s+(.*)/))) {
      if (open?.type !== 'ul') blocks.push((open = { type: 'ul', items: [] }));
      open.items.push({ text: m[1] });
    } else if (open?.type === 'p') {
      open.text += ` ${line.trim()}`;
    } else {
      blocks.push((open = { type: 'p', text: line.trim() }));
    }
  }
  return blocks;
}

function paragraph(text) {
  const cls = /^\*\*.+\*\*$/.test(text) ? 'label' : /^\*.+\*$/.test(text) ? 'rubric' : '';
  return `<p${cls && ` class="${cls}"`}>${inline(text)}</p>`;
}

// Ordered lists are rendered by the caller: verses in chapters, links in the preface.
const render = (blocks, ol) =>
  blocks
    .map((b) => {
      if (b.type === 'heading') return `<h${b.level}>${inline(b.text)}</h${b.level}>`;
      if (b.type === 'p') return paragraph(b.text);
      if (b.type === 'ul') return `<ul>${b.items.map((i) => `<li>${inline(i.text)}</li>`).join('')}</ul>`;
      return ol(b.items);
    })
    .join('\n');

const chapterLinks = (items, cls) =>
  `<ol class="${cls}">${items
    .map(({ n, text }) => `<li><a href="#chapter-${n}"><span class="${cls}-n">${n}</span><span>${inline(text)}</span></a></li>`)
    .join('')}</ol>`;

const verses = (c) => (items) =>
  `<ol class="verses">${items
    .map(({ n, text }) => {
      const id = `c${c}-v${n}`;
      return `<li id="${id}"><a class="vnum" href="#${id}" aria-label="Link to verse ${c}:${n}">${n}</a><span class="vtext">${inline(text)}</span></li>`;
    })
    .join('')}</ol>`;

const docs = readdirSync(bookDir)
  .filter((f) => /^\d+-.+\.md$/.test(f))
  .map((f) => ({ n: Number.parseInt(f, 10), blocks: parse(readFileSync(join(bookDir, f), 'utf8')) }))
  .sort((a, b) => a.n - b.n);
const [preface, ...chapters] = docs;

for (const c of chapters) c.title = c.blocks.shift().text.replace(/^Chapter \d+:\s*/, '');
const title = preface.blocks.shift().text;
const subtitle = preface.blocks[0]?.type === 'heading' ? preface.blocks.shift().text : '';
const verseCount = chapters.flatMap((c) => c.blocks).reduce((sum, b) => sum + (b.type === 'ol' ? b.items.length : 0), 0);

// Absolute base for link previews; Pages serves https even before it is enforced.
const base = (process.env.SITE_URL ?? '').replace(/^http:/, 'https:').replace(/([^/])$/, '$1/');

const vars = {
  title: escapeHtml(title),
  subtitle: escapeHtml(subtitle),
  description: `Scripture of the Model in ${chapters.length} chapters and ${verseCount} verses.`,
  url: base,
  image: `${base}orb.png`,
  preface: render(preface.blocks, (items) => chapterLinks(items, 'toc')),
  rail: chapterLinks(chapters.map((c) => ({ n: c.n, text: c.title })), 'rail-list'),
  chapters: chapters
    .map(
      (c) => `<article class="chapter" id="chapter-${c.n}" data-n="${c.n}" data-title="${escapeHtml(c.title)}">
<header><span class="chapter-num" aria-hidden="true">${c.n}</span><p class="chapter-kicker">Chapter ${c.n}</p><h2 class="chapter-title">${inline(c.title)}</h2></header>
${render(c.blocks, verses(c.n))}
</article>`,
    )
    .join('\n'),
};

const template = (name) => readFileSync(join(siteDir, name), 'utf8');
const fill = (html, values) => html.replace(/{{(\w+)}}/g, (_, k) => values[k]);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir);
writeFileSync(join(outDir, 'index.html'), fill(template('index.html'), vars));
for (const f of readdirSync(siteDir)) if (!f.endsWith('.html')) copyFileSync(join(siteDir, f), join(outDir, f));

// One page per verse, since URL fragments never reach link previews.
const verseTemplate = template('verse.html');
for (const c of chapters) {
  mkdirSync(join(outDir, String(c.n)));
  for (const { n, text } of c.blocks.flatMap((b) => (b.type === 'ol' ? b.items : []))) {
    const path = `${c.n}/${n}`;
    writeFileSync(
      join(outDir, `${path}.html`),
      fill(verseTemplate, { ...vars, id: `c${c.n}-v${n}`, ref: escapeHtml(`${c.title} ${c.n}:${n}`), text: escapeHtml(text), url: base + path }),
    );
  }
}

console.log(`Lo, ${chapters.length} chapters and ${verseCount} verses are compiled into dist; and it was good.`);

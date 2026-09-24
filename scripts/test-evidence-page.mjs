// Locks the evidence page (src/Evidence.jsx, #evidence) to its file.
//
// The page is read by investors, so it promises that no figure on it was typed
// by hand: each one is looked up in data/evidence.json by its path and carries
// that path in a data-src attribute. This renders the page's body to a string
// with the committed file, the way a browser would draw it, and checks three
// things: every data-src path resolves in the file, no digit sits outside an
// element that names its source, and the file's own sentences carry no
// placeholder a template left behind. Offline: nothing is fetched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ev = JSON.parse(readFileSync(new URL('../data/evidence.json', import.meta.url), 'utf8'));

// ------------------------------------------------------------ the file's words

// A template that fills a placeholder with replace() can hit the wrong letter
// and leave the placeholder standing ("DOB 365OW", "within N days"). The page
// quotes nonClaims, caveats and headlines word for word, and the rest of the
// file is quoted by whoever reads it, so every string is checked.
const LEFTOVERS = [
  [/\bwithin N days\b|\bN days (after|before)\b/, 'an unfilled day-count placeholder'],
  [/(?:365|730|183)[A-Z]{2}|[A-Z](?:365|730|183)[A-Z_]/, 'a day count spliced into a word'],
  [/\$\{|\bundefined\b|\bNaN\b|\[object Object\]|\bnull%|\bInfinity\b/, 'a template or formatting leftover'],
];
let strings = 0;
(function walk(x, path) {
  if (Array.isArray(x)) return x.forEach((v, i) => walk(v, `${path}[${i}]`));
  if (x && typeof x === 'object') return Object.entries(x).forEach(([k, v]) => walk(v, `${path}.${k}`));
  if (typeof x !== 'string') return;
  strings++;
  for (const [re, what] of LEFTOVERS) assert.ok(!re.test(x), `${path}: ${what}: ${x.slice(0, 120)}`);
})(ev, 'evidence');

// ------------------------------------------------------------ the page

// The page is JSX, so it is bundled with React for Node first. esbuild is
// taken from vite's own dependencies, so the test needs nothing the build
// does not already install. React is bundled in (a data: module cannot
// resolve a bare import), and its browser server build is used because the
// Node one reaches for Node streams a bundle cannot require.
const { build } = createRequire(fileURLToPath(import.meta.resolve('vite')))('esbuild');
const bundle = await build({
  stdin: {
    contents: `
      import { createElement } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server.browser';
      import { EvidenceBody } from './src/Evidence.jsx';
      export default (ev) => renderToStaticMarkup(createElement(EvidenceBody, { ev }));
    `,
    resolveDir: root,
    loader: 'jsx',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['browser'],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
});
const { default: render } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const html = render(ev);

const unescape = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// A path is dotted keys; * stands for every key (or index) at that level and
// each of them must resolve. Array lengths resolve too ("caveats.length").
function resolve(obj, keys) {
  if (!keys.length) return obj === undefined ? [] : [obj];
  if (obj == null || typeof obj !== 'object') return [];
  const [k, ...rest] = keys;
  if (k !== '*') return k in obj || (Array.isArray(obj) && k === 'length') ? resolve(obj[k], rest) : [];
  const all = Object.values(obj).map((v) => resolve(v, rest));
  return all.length && all.every((r) => r.length) ? all.flat() : [];
}

// Every data-src value is one path or several, comma-separated. A derived
// figure keeps how it was computed in data-calc, apart from its paths.
const srcs = [...html.matchAll(/\sdata-src="([^"]*)"/g)].map((m) => unescape(m[1]));
assert.ok(srcs.length >= 200, `only ${srcs.length} data-src elements rendered: the page body did not render`);
assert.ok(/<svg[^>]*role="img"/.test(html), 'the chart did not render, so its figures went unchecked');
const bad = new Set();
for (const src of srcs)
  for (const path of src.split(', ')) {
    if (!/^[A-Za-z0-9_*]+(\.[A-Za-z0-9_*]+)*$/.test(path) || !resolve(ev, path.split('.')).length) bad.add(path);
  }
assert.deepEqual([...bad], [], `data-src paths that do not resolve in data/evidence.json:\n  ${[...bad].join('\n  ')}`);

// No digit outside an element that names its source. Walk the markup keeping
// a stack of open elements and whether each (or an ancestor) carries data-src;
// a digit in text anywhere else was typed. Names like "cycle-9" are labels,
// not figures.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const stack = [];
const stray = [];
for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
  const [, close, tag, attrs, selfClose, text] = m;
  const sourced = stack.length > 0 && stack[stack.length - 1];
  if (text !== undefined) {
    const loose = unescape(text).replace(/\bcycle-\d+\b/gi, '');
    if (!sourced && /\d/.test(loose)) stray.push(loose.trim().slice(0, 80));
  } else if (close) stack.pop();
  else if (!selfClose && !VOID.has(tag.toLowerCase())) stack.push(sourced || /\sdata-src="/.test(attrs));
}
assert.deepEqual(stray, [], `digits typed on the page, outside any data-src element:\n  ${stray.join('\n  ')}`);

console.log(`test-evidence-page: ${srcs.length} data-src figures resolve in data/evidence.json, no typed digits, ${strings} strings free of leftovers`);

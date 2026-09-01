// Fails the build if src/ contains a circular import.
//
// Why it exists: a render crash in production was reported as an intermittent
// module-initialisation race, the classic symptom of a cycle. The audit found
// no cycle (the actual bug was a const read before its line ran), but the
// symptom is bad enough — a blank page for whoever loses the race — that the
// class of bug is worth locking out at build time. Zero dependencies on
// purpose: a checker that needs installing is a checker that gets skipped.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SRC = join(ROOT, 'src');
const EXTS = ['.js', '.jsx', '.mjs'];

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXTS.some((e) => p.endsWith(e))) files.push(p);
  }
})(SRC);

// Static `import ... from 'x'`, bare `import 'x'`, `export ... from 'x'` and
// dynamic `import('x')` — the four ways a module edge exists in this codebase.
const EDGE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) return null; // packages cannot cycle with src/
  const base = resolve(dirname(from), spec.split('?')[0]); // strip ?worker&url etc.
  for (const cand of ['', ...EXTS, ...EXTS.map((e) => sep + 'index' + e)]) {
    try {
      const p = base + cand;
      if (statSync(p).isFile()) return p;
    } catch {}
  }
  return null;
}

const graph = new Map(
  files.map((f) => {
    const text = readFileSync(f, 'utf8');
    const deps = [];
    for (const m of text.matchAll(EDGE)) {
      const dep = resolveSpec(f, m[1] || m[2] || m[3]);
      if (dep) deps.push(dep);
    }
    return [f, deps];
  }),
);

const state = new Map(); // 1 = on stack, 2 = done
const stack = [];
function visit(f) {
  if (state.get(f) === 2) return null;
  if (state.get(f) === 1) return stack.slice(stack.indexOf(f)).concat(f);
  state.set(f, 1);
  stack.push(f);
  for (const dep of graph.get(f) || []) {
    const cycle = visit(dep);
    if (cycle) return cycle;
  }
  stack.pop();
  state.set(f, 2);
  return null;
}

for (const f of files) {
  const cycle = visit(f);
  if (cycle) {
    console.error('Circular import — this can crash module initialisation at load time:');
    console.error('  ' + cycle.map((p) => p.slice(ROOT.length + 1)).join('\n  → '));
    process.exit(1);
  }
}
console.log(`check-cycles: ${files.length} modules, no circular imports`);

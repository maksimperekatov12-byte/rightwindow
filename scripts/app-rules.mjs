// The trade filters and the cohort chips, read out of src/App.jsx itself.
//
// The lite shell has to quote register-wide figures that depend on them — how
// many facade buildings an equipment firm sees, which cohort chips a register
// will offer — before the full feed arrives. A copy of the predicates here
// would drift the first time somebody retunes a trade, and the lite numbers
// would silently stop matching the page they announce. So the two plain-JS
// blocks that hold them (the top of the file through the closing brace of
// PROFILES, and `const days` through REG_COHORTS) are evaluated as they stand.
//
// Nothing here renders anything: only the predicates are called. If either
// block stops evaluating on its own — a JSX element, a top-level call into an
// import — this throws with the reason, and prebuild stops rather than ship
// lite numbers computed with the wrong rules.
import { readFileSync } from 'node:fs';

const APP = new URL('../src/App.jsx', import.meta.url);

// From `start` through the first top-level "};" after `anchor`.
function through(src, start, anchor) {
  const at = src.indexOf(anchor, start);
  const end = at < 0 ? -1 : src.indexOf('\n};\n', at);
  if (start < 0 || end < 0) throw new Error(`app-rules: cannot find ${JSON.stringify(anchor.trim())} and its closing "};" in src/App.jsx`);
  return src.slice(start, end + 4);
}

export function readAppRules(src = readFileSync(APP, 'utf8')) {
  // The helpers the predicates call (has, facadeBid, isVenue …) sit between
  // the imports and PROFILES; the imports themselves are dropped.
  const head = through(src, 0, '\nconst PROFILES = {')
    .split('\n')
    .filter((line) => !/^import\s/.test(line))
    .join('\n');
  const cohorts = through(src, src.indexOf('\nconst days = '), '\nconst REG_COHORTS = {');
  try {
    return new Function(`${head}\n${cohorts}\nreturn { PROFILES, COHORTS, REG_COHORTS };`)();
  } catch (e) {
    throw new Error(`app-rules: the PROFILES/COHORTS blocks of src/App.jsx no longer evaluate on their own (${e.message})`);
  }
}

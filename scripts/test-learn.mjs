// Run with: node scripts/test-learn.mjs
import { rulesFrom, taughtAway, describeRules, reasonsFor, NO_LESSON } from '../src/learn.js';

let pass = 0, fail = 0;
const is = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

const bronx = { bin: '1', borough: 'Bronx', subCycle: '10A', occupied: false, agent: { contactKnown: true } };
const bronx2 = { bin: '2', borough: 'Bronx', subCycle: '10B', occupied: false, agent: { contactKnown: true } };
const queens = { bin: '3', borough: 'Queens', subCycle: '10A', occupied: false, agent: { contactKnown: true } };
const noCall = { bin: '4', borough: 'Queens', subCycle: '10A', occupied: false, agent: { contactKnown: false } };

// One dismissal is not a lesson.
let fb = { 'b:1': { s: 'dismissed', t: 1, r: 'area', v: 'Bronx' } };
is('one dismissal teaches nothing', rulesFrom(fb).size, 0);
is('  and hides nothing else', taughtAway(rulesFrom(fb), 'b:', bronx2), false);

// Two of the same reason and value becomes a rule.
fb['b:2'] = { s: 'dismissed', t: 2, r: 'area', v: 'Bronx' };
let rules = rulesFrom(fb);
is('two dismissals make a rule', rules.size, 1);
is('  it hides another Bronx building', taughtAway(rules, 'b:', bronx2), true);
is('  it leaves Queens alone', taughtAway(rules, 'b:', queens), false);
is('  and it is described for the user', describeRules(rules)[0].text, 'Bronx buildings');

// Different values do not add up.
fb = {
  'b:1': { s: 'dismissed', t: 1, r: 'area', v: 'Bronx' },
  'b:2': { s: 'dismissed', t: 2, r: 'area', v: 'Queens' },
};
is('two areas stay one dismissal each', rulesFrom(fb).size, 0);

// "Just not a fit" never becomes a rule, however often it is used.
fb = {
  'b:1': { s: 'dismissed', t: 1, r: 'other', v: NO_LESSON },
  'b:2': { s: 'dismissed', t: 2, r: 'other', v: NO_LESSON },
  'b:3': { s: 'dismissed', t: 3, r: 'other', v: NO_LESSON },
};
is('"not a fit" teaches nothing', rulesFrom(fb).size, 0);

// A boolean-ish reason: no published contact.
fb = {
  'b:1': { s: 'dismissed', t: 1, r: 'nocall', v: 'nocontact' },
  'b:2': { s: 'dismissed', t: 2, r: 'nocall', v: 'nocontact' },
};
rules = rulesFrom(fb);
is('no-contact rule hides unreachable buildings', taughtAway(rules, 'b:', noCall), true);
is('  and keeps reachable ones', taughtAway(rules, 'b:', queens), false);
is('  described plainly', describeRules(rules)[0].text, 'buildings with no published contact');

// Rules are scoped to their register.
fb = {
  'c:1': { s: 'dismissed', t: 1, r: 'agency', v: 'DEPT OF PARKS' },
  'c:2': { s: 'dismissed', t: 2, r: 'agency', v: 'DEPT OF PARKS' },
};
rules = rulesFrom(fb);
is('a contract rule hides that agency', taughtAway(rules, 'c:', { agency: 'DEPT OF PARKS' }), true);
is('  and does not touch buildings', taughtAway(rules, 'b:', bronx), false);
is('  agency reads as English', describeRules(rules)[0].text, 'awards from Dept Of Parks');

// Dismissals without a reason are inert.
fb = { 'b:1': { s: 'dismissed', t: 1 }, 'b:2': { s: 'dismissed', t: 2 } };
is('reasonless dismissals teach nothing', rulesFrom(fb).size, 0);

// Undo path: stripping r/v drops the rule.
fb = {
  'b:1': { s: 'dismissed', t: 1, r: 'area', v: 'Bronx' },
  'b:2': { s: 'dismissed', t: 2, r: 'area', v: 'Bronx' },
};
is('rule is live before undo', rulesFrom(fb).size, 1);
fb = Object.fromEntries(Object.entries(fb).map(([k, v]) => [k, { s: v.s, t: v.t }]));
is('undo removes the rule, keeps the dismissals', [rulesFrom(fb).size, Object.keys(fb).length], [0, 2]);

// Only reasons the card can actually be judged on are offered: this building is
// not occupied and its agent is reachable, so those two are withheld.
is(
  'offers only answerable reasons',
  reasonsFor('b:').filter((r) => r.k === 'other' || r.of(bronx)).map((r) => r.k),
  ['area', 'far', 'other'],
);
const busy = { ...bronx, occupied: true, agent: { contactKnown: false } };
is(
  'offers the rest when they apply',
  reasonsFor('b:').filter((r) => r.k === 'other' || r.of(busy)).map((r) => r.k),
  ['area', 'taken', 'nocall', 'far', 'other'],
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

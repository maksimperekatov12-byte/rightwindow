// Slack delivery. A signal arrives as a card; when interactivity is configured
// it carries Claim / Not for us buttons that write the same global claim the
// website uses, so nobody double-calls.
//
// Without SLACK_SIGNING_SECRET the interaction endpoint rejects every press with
// a 401 — so the buttons are omitted rather than shipped dead. A button that
// does nothing is worse than no button.
import { matchFor, money } from './signals.mjs';

const SITE = process.env.SITE || 'https://rightwindow.nyc';
export const claimsInteractive = () => Boolean(process.env.SLACK_SIGNING_SECRET);

export function signalBlocks(item, profileLabel) {
  const url = `${SITE}/#${item.kind}/${item.id}`;
  const key = `${item.kind}:${item.id}`;
  const lines = [`*<${url}|${item.title}>*`, item.why];
  if (item.urgent) lines.push(`:rotating_light: *${item.urgent}*`);
  const c = item.raw;
  const facts = [];
  if (item.kind === 'b') {
    if (c.agent?.company) facts.push(`Contact: ${c.agent.company}${c.agent.name ? ` — ${c.agent.name}` : ''}`);
    if (c.ecbBalance > 0) facts.push(`Open penalties: ${money(c.ecbBalance)}`);
    if (c.elevator?.cat1Missing) facts.push(`Elevators due: ${c.elevator.cat1Missing}`);
  }
  if (item.kind === 'c' && c.vendorAddress) facts.push(`Address: ${c.vendorAddress}`);
  if (item.kind === 'o' && c.legal) facts.push(`Legal name: ${c.legal}`);
  if (facts.length) lines.push(facts.map((f) => `_${f}_`).join('  ·  '));

  const actions = claimsInteractive()
    ? [
        {
          type: 'button',
          action_id: 'claim',
          style: 'primary',
          text: { type: 'plain_text', text: 'Claim it' },
          value: key,
        },
        { type: 'button', action_id: 'skip', text: { type: 'plain_text', text: 'Not for us' }, value: key },
        { type: 'button', action_id: 'open', url, text: { type: 'plain_text', text: 'Open card' } },
      ]
    : [{ type: 'button', action_id: 'open', url, style: 'primary', text: { type: 'plain_text', text: 'Open card' } }];

  return [
    { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
    { type: 'actions', block_id: `sig:${key}`, elements: actions },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Right Window · matched to ${profileLabel} · from NYC public records` }] },
  ];
}

export async function postToSlack(webhook, blocks, fallback) {
  // A dead webhook host used to throw straight out of the notify loop, before
  // sentKeys was persisted — so everyone already messaged got messaged again on
  // the next tick, forever, until that one host recovered.
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: fallback, blocks }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (e) {
    console.log(`slack post failed: ${e.message}`);
    return false;
  }
}

export function digestBlocks(items, profileLabel, heading) {
  const out = [{ type: 'header', text: { type: 'plain_text', text: heading } }];
  for (const it of items.slice(0, 5)) out.push(...signalBlocks(it, profileLabel), { type: 'divider' });
  out.pop();
  return out;
}

export { matchFor };

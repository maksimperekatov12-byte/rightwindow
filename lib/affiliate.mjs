// Offline affiliate resolution.
//
// A single-purpose holding LLC publishes nothing anywhere — that is the ceiling
// every contact search hits, and it accounted for 11 of the 50 agents in the
// first measured sample. But the city's own filing already carries the thread:
// HPD names a head officer on every registration, and the same person signs for
// the holding LLC and for the firm that actually runs the building.
//
// So where a company has no contact of its own but shares a head officer with a
// company that does, the contact propagates — labelled `affiliate`, with the
// operator named. The evidence is a city record by construction, which is the
// bar the tier was built to hold; no search API, no provider, no guessing.
//
// Deliberately NOT inferred from a shared address: 515 Madison's 29th floor and
// 199 Lee Avenue are mail drops shared by hundreds of unrelated entities.

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

export function resolveAffiliates(cards) {
  // Who is a company's contact, and who signs for that company.
  const contactByCompany = new Map();
  const companiesByOfficer = new Map();

  for (const c of cards) {
    const a = c.agent;
    if (!a?.company) continue;
    const co = norm(a.company);
    if (!co) continue;
    if ((a.phone || a.email) && !contactByCompany.has(co)) {
      contactByCompany.set(co, {
        company: a.company,
        phone: a.phone || null,
        email: a.email || null,
        source: a.contactSource || null,
      });
    }
    const officer = norm(a.headOfficer);
    if (!officer) continue;
    if (!companiesByOfficer.has(officer)) companiesByOfficer.set(officer, new Set());
    companiesByOfficer.get(officer).add(co);
  }

  let filled = 0;
  for (const c of cards) {
    const a = c.agent;
    if (!a?.company || a.phone || a.email) continue;
    const officer = norm(a.headOfficer);
    if (!officer) continue;
    const siblings = companiesByOfficer.get(officer);
    if (!siblings) continue;
    const self = norm(a.company);
    for (const sib of siblings) {
      if (sib === self) continue;
      const hit = contactByCompany.get(sib);
      if (!hit) continue;
      a.phone = hit.phone;
      a.email = hit.email;
      a.confidence = 'affiliate';
      a.contactSource = hit.source || 'HPD registration';
      a.via = hit.company;
      a.viaEvidence = `HPD names ${a.headOfficer} as head officer for both`;
      filled++;
      break;
    }
  }
  return filled;
}

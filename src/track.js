// The client half of the first-party log.
//
// Rules it keeps: never block the interaction it is reporting, never retry,
// never carry anything the page did not already know about the visitor. If
// the endpoint is down the product behaves identically — a lost event is a
// lost row in a sales report, not a broken page.
let ctx = { ref: null, trade: null, zips: [], reg: null, sid: null };

export function setTrackContext(next) {
  ctx = { ...ctx, ...next };
}

export function track(kind, extra = {}) {
  try {
    const body = JSON.stringify({ kind, ...ctx, ...extra });
    // sendBeacon survives the navigation a "Call" link starts; fetch is the
    // fallback where it is missing.
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {}
}

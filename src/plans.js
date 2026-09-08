// Prices, in one place, so nobody has to grep for a number before an email
// goes out.
//
// TODO(Maxim): set these two amounts. Until TERRITORY_MONTHLY is a number the
// row prints "pricing on request" rather than a made-up figure, and until
// VITE_STRIPE_LIST_URL is set in the environment the one-time row is hidden
// rather than rendered as a dead button.
export const TERRITORY_MONTHLY = null; // e.g. 400 → "$400/mo"
export const ONE_TIME_LIST = null; //     e.g. 250 → "$250"

export const PILOT_DAYS = 60;

// Read at build time by Vite; empty means the line does not exist.
export const STRIPE_LIST_URL = import.meta.env?.VITE_STRIPE_LIST_URL || '';

export const money = (n) => (typeof n === 'number' && n > 0 ? `$${n.toLocaleString('en-US')}` : null);

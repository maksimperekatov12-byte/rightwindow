// Starts fetching the full register the moment the module graph loads — in
// parallel with React booting — so the shell paints from feed-lite while this
// is already on the wire. One shared promise: whoever lands first, there is
// exactly one request.
import feedUrl from './data/feed.json?url';

export const feedPromise = fetch(feedUrl).then((r) => {
  if (!r.ok) throw new Error(`feed fetch ${r.status}`);
  return r.json();
});
// A shell that keeps working on lite data beats a blank page: the consumer
// decides what to do about a failed fetch.
feedPromise.catch(() => {});

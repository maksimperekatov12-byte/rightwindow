// One way to put a document somewhere the app can read it, and one way to read
// it back. Everything that publishes or consumes a data artefact goes through
// here, so no call site knows or cares which backend is live.
//
// Why it exists: the data plane was an orphan git branch force-pushed to a
// public GitHub repository and read through GitHub's CDN. That works and costs
// nothing, but GitHub is not a data plane, and it is a question due diligence
// will ask. STORAGE_DRIVER switches the backend without touching a caller.
//
//   github-branch  the current behaviour, kept as the fallback
//   r2             Cloudflare R2 over the S3 API
//
// PRIVACY IS PART OF THE INTERFACE, not a property of the backend. An artefact
// declares whether it may be world-readable, and a backend that cannot honour
// that refuses the write rather than performing it. The `github-branch` driver
// publishes to a public branch, so it will not store a private artefact at all —
// subscriber email addresses must never be force-pushed to a public repository,
// and the way to make that impossible is to make it an error.
import { createHash, createHmac } from 'node:crypto';

export const DRIVER = () => process.env.STORAGE_DRIVER || 'github-branch';

// The catalogue. Adding an artefact here is what makes it publishable.
export const ARTIFACTS = {
  // The five-minute pulse and intraday changes. Public by design: it is what
  // proves to a visitor that the site is live.
  intraday: { file: 'intraday.json', visibility: 'public' },
  // Business telephone numbers of managing agents, each with its source named.
  // Public by design — see lib/provenance.mjs for what is allowed in and why.
  contacts: { file: 'contacts.json', visibility: 'public' },
  // People who asked for the daily digest. Never public.
  subscribers: { file: 'subscribers.json', visibility: 'private' },
  // People who clicked unsubscribe. Consulted by every sender; never public.
  suppressed: { file: 'suppressed.json', visibility: 'private' },
};

export class VisibilityError extends Error {}

// Private artefacts get a second home: Vercel Blob. It came back to life with
// the Pro upgrade on 2026-08-31, and it is exactly what a subscriber list
// wants — server-readable, never world-readable, no git history. R2 still wins
// when configured, because it is the declared destination; Blob is the one
// that exists today.
const blobReady = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

// ---- github-branch ---------------------------------------------------------
//
// Reads come from GitHub's CDN and cost nothing. Writes are performed by the
// workflows, which hold the token; this module only reads under that driver, and
// says so rather than pretending a write succeeded.
const REPO = () => process.env.DATA_REPO || 'maksimperekatov12-byte/rightwindow';
const BRANCH = () => process.env.DATA_BRANCH || 'data';

const githubUrl = (file) => `https://raw.githubusercontent.com/${REPO()}/${BRANCH()}/${file}`;

async function githubRead(file) {
  const r = await fetch(githubUrl(file), {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) return null;
  return r.json();
}

// ---- r2 (Cloudflare, S3 API) -----------------------------------------------
//
// Signed by hand with SigV4 rather than pulling in an SDK: the two calls needed
// here are a PUT and a GET of a single object, and the signing is the same
// twenty lines either way.
const r2Env = () => ({
  account: process.env.R2_ACCOUNT_ID,
  bucket: process.env.R2_BUCKET,
  key: process.env.R2_ACCESS_KEY_ID,
  secret: process.env.R2_SECRET_ACCESS_KEY,
  // Optional: a public bucket domain, used for reads that do not need signing.
  publicBase: process.env.R2_PUBLIC_BASE_URL || null,
});

const sha256hex = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();

function signedHeaders({ method, host, path, body, key, secret, region = 'auto', service = 's3' }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body ?? '');

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedList = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = [method, path, '', canonicalHeaders, signedList, payloadHash].join('\n');

  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');

  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');

  return {
    host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${signedList}, Signature=${signature}`,
  };
}

async function r2Request(method, file, body) {
  const { account, bucket, key, secret } = r2Env();
  if (!account || !bucket || !key || !secret)
    throw new Error('R2 is selected but R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are not all set');
  const host = `${account}.r2.cloudflarestorage.com`;
  const path = `/${bucket}/${file}`;
  const headers = signedHeaders({ method, host, path, body, key, secret });
  const r = await fetch(`https://${host}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ?? undefined,
    signal: AbortSignal.timeout(15000),
  });
  return r;
}

async function r2Read(file) {
  const { publicBase } = r2Env();
  // A public bucket domain needs no signature and can be edge-cached.
  if (publicBase) {
    const r = await fetch(`${publicBase.replace(/\/$/, '')}/${file}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    return r.ok ? r.json() : null;
  }
  const r = await r2Request('GET', file);
  if (!r.ok) return null;
  return r.json();
}

async function r2Write(file, json) {
  const r = await r2Request('PUT', file, JSON.stringify(json));
  if (!r.ok) throw new Error(`R2 write failed for ${file}: ${r.status} ${(await r.text()).slice(0, 160)}`);
}

// ---- the interface ---------------------------------------------------------

/**
 * Read an artefact. Returns null when it is absent or unreadable — the caller
 * decides what an absence means, because "missing" and "broken" are the same
 * thing to a reader and very different things to a writer.
 */
export async function readArtifact(name) {
  const spec = ARTIFACTS[name];
  if (!spec) throw new Error(`Unknown artefact: ${name}`);
  try {
    if (DRIVER() === 'r2') return await r2Read(spec.file);
    if (spec.visibility === 'private' && blobReady()) {
      const { readJsonSoft } = await import('./store.mjs');
      return await readJsonSoft(spec.file);
    }
    return await githubRead(spec.file);
  } catch {
    return null;
  }
}

/**
 * Publish an artefact.
 *
 * Under `r2` this writes directly. Under `github-branch` it does not write at
 * all: that branch is force-pushed by the workflows, which hold the token, so a
 * write here would be a lie. It returns {written:false, reason} and the caller
 * hands the file to the workflow instead.
 *
 * A private artefact under a public driver throws. That is deliberate: the way
 * to guarantee subscriber addresses never reach a public branch is to make the
 * attempt fail loudly rather than to remember not to make it.
 */
export async function publishArtifact(name, json) {
  const spec = ARTIFACTS[name];
  if (!spec) throw new Error(`Unknown artefact: ${name}`);
  const driver = DRIVER();

  if (driver === 'github-branch' && spec.visibility === 'private') {
    if (blobReady()) {
      const { writeJson } = await import('./store.mjs');
      await writeJson(spec.file, json);
      return { written: true, driver: 'vercel-blob' };
    }
    throw new VisibilityError(
      `"${name}" is private and the github-branch driver publishes to a public branch. ` +
        'Configure R2 or Vercel Blob before storing it.',
    );
  }

  if (driver === 'r2') {
    await r2Write(spec.file, json);
    return { written: true, driver };
  }
  return {
    written: false,
    driver,
    reason: 'github-branch is published by the workflow, not by this process',
    file: spec.file,
  };
}

/** Whether a private artefact can be stored at all right now. */
export const canStorePrivate = () => DRIVER() === 'r2' || blobReady();

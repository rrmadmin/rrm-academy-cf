/**
 * Fixtures for the on-demand OG image renderer (functions/og/[[path]].js).
 *
 * Two things have to be true before that module can be imported at all under
 * `node --test`, and both are arranged HERE, before the dynamic import below:
 *
 *   1. `import ogIndex from '../../src/data/og-index.json'` -- a gitignored
 *      build artifact, absent on a clean CI checkout, and imported with no
 *      import attribute. `_json-module-hook.mjs` already serves it as `{}`.
 *   2. `import { ImageResponse } from 'workers-og'` -- resolves a .wasm that
 *      Node cannot load. `_workers-og-stub.mjs` replaces the whole package.
 *
 * Both hooks are test-only and change nothing that ships.
 */
import { registerHooks } from 'node:module';
import './_json-module-hook.mjs';

const STUB_URL = new URL('./_workers-og-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'workers-og') {
      return { url: STUB_URL, format: 'module', shortCircuit: true };
    }
    return next(specifier, context);
  },
});

export { renders, resetRenders } from './_workers-og-stub.mjs';

export const og = await import('../functions/og/[[path]].js');

/**
 * Font loading is a network fetch in production. Here it must be BOTH offline
 * and deterministic, so every font URL is answered with a not-ok response --
 * the exact shape loadFont() already treats as "no font" (defence B4). The
 * stubbed ImageResponse does not care how many fonts it was given, so this
 * removes the network without removing anything the tests assert on.
 *
 * Returns a restore function.
 */
export function stubFontFetch() {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });
  return () => { globalThis.fetch = real; };
}

/**
 * Analytics Engine binding that records instead of shipping.
 *
 * This is the ONLY externally observable signal that says WHICH lookup branch
 * the handler took: a hit and a fallback both return 200 image/png, so a test
 * asserting only on the response cannot tell an event card from the branded
 * fallback and would pass just as happily if the event branch were deleted.
 */
export function recordingEvents() {
  const points = [];
  return {
    points,
    binding: { writeDataPoint: (p) => points.push(p) },
    /** The status label the handler logged for the most recent render. */
    lastStatus: () => points.at(-1)?.blobs?.[3] ?? null,
  };
}

/** Drives onRequest for `/og/<slug>.png`, with fonts stubbed and AE recorded. */
export async function renderOg(slug, { env = {} } = {}) {
  const restore = stubFontFetch();
  const events = recordingEvents();
  try {
    const response = await og.onRequest({
      request: new Request(`https://rrmacademy.org/og/${slug}`),
      env: { EVENTS: events.binding, ...env },
      params: { path: [slug] },
    });
    return {
      response,
      status: response.status,
      contentType: response.headers.get('Content-Type'),
      cacheControl: response.headers.get('Cache-Control'),
      statusLabel: events.lastStatus(),
      points: events.points,
    };
  } finally {
    restore();
  }
}

/**
 * Flattens a satori tree to the list of TEXT strings it will print, in order.
 *
 * Asserting on rendered text rather than on tree coordinates is deliberate: the
 * copy on the card is the thing under review (no em dashes, "Save the Uterus
 * Club" in full, the date format), and it must stay assertable when the layout
 * is retuned.
 */
export function textOf(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const child of node) textOf(child, out); return out; }
  if (node.props) textOf(node.props.children, out);
  return out;
}

/** Every node in a satori tree, depth-first, so a test can look for an <img>. */
export function nodesOf(node, out = []) {
  if (node == null || typeof node === 'string') return out;
  if (Array.isArray(node)) { for (const child of node) nodesOf(child, out); return out; }
  out.push(node);
  if (node.props) nodesOf(node.props.children, out);
  return out;
}

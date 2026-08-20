/**
 * Stand-in for the `workers-og` ImageResponse, for unit tests only.
 *
 * WHY A STUB IS NECESSARY RATHER THAN CONVENIENT
 * ---------------------------------------------
 * `workers-og` reaches its renderer through `import ... from './yoga-*.wasm'`.
 * Wrangler's esbuild bundle resolves that; plain Node does not, and the failure
 * is at RESOLVE time (ERR_MODULE_NOT_FOUND for a package named 'a', from inside
 * the .wasm file), so it happens before any test body runs. That single import
 * is why `functions/og/[[path]].js` -- 700-odd lines of routed, user-facing,
 * deploy-on-every-push code -- has never been importable under `node --test`
 * and has sat at 0% coverage in scripts/quality/coverage-census.json.
 *
 * WHAT IT DOES, AND WHAT THAT BUYS
 * --------------------------------
 * It records the satori TREE and the options it was handed, and returns a
 * Response whose body is a real (tiny) PNG. That is strictly more than a
 * network-backed render could assert: a test can check WHICH card the handler
 * chose and WHAT it put on it, deterministically and offline, instead of
 * inferring layout from PNG bytes.
 *
 * WHAT IT DELIBERATELY DOES NOT PROVE
 * -----------------------------------
 * Nothing about satori or resvg. Whether a tree this stub captured actually
 * rasterises without clipping is a RENDER question, and it is answered by
 * rendering it -- the local satori+resvg preview recipe in CLAUDE.md, run
 * against these exact tree-builders before the code was committed.
 */

/** Every tree this stub has been constructed with, newest last. */
export const renders = [];

/** Discards the render log. Call in beforeEach so cases cannot read each other. */
export function resetRenders() {
  renders.length = 0;
}

/** 68-byte 1x1 PNG, so the body is a real image rather than an empty stream. */
const ONE_PIXEL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
  0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

export class ImageResponse extends Response {
  constructor(tree, options) {
    super(ONE_PIXEL_PNG, { status: 200, headers: { 'Content-Type': 'text/html' } });
    renders.push({ tree, options });
  }
}

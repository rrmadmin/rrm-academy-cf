/**
 * Makes the CF Pages Functions module graph importable under plain `node --test`.
 *
 * WHY THIS EXISTS
 * `functions/api/courses/_shared.js` does `import coursesData from
 * '../../../src/data/courses.json'` with no import attribute. Wrangler's esbuild
 * bundle accepts that; Node ESM does not (ERR_IMPORT_ATTRIBUTE_MISSING, the
 * attribute became mandatory in Node 22). On top of that, `src/data/courses.json`
 * is a build artifact and is gitignored, so a `npm ci && npm test` CI job does
 * not even have the file.
 *
 * Between them those two facts made `functions/api/stripe-webhook.js` and
 * `functions/api/billing/_webhook-checkout.js` IMPOSSIBLE to import in a unit
 * test -- which is why the previous stripe-webhook.test.js read them with
 * readFileSync and asserted on source TEXT, and why the whole billing webhook
 * cluster (1,956 lines) reported 0% coverage while looking tested.
 *
 * WHAT IT DOES
 * Registers synchronous module hooks (node:module registerHooks, Node >= 22.15)
 * that:
 *   1. supply `type: 'json'` for any .json module load, so the bare imports
 *      resolve exactly as they do in the bundler;
 *   2. serve a small deterministic FIXTURE for the gitignored build artifacts,
 *      always -- including on machines where the real file happens to exist --
 *      so a local run and a CI run load byte-identical data.
 *
 * This is test-only. It does not change what ships. The production fix (adding
 * `with { type: 'json' }` and committing a checked-in courses fixture) is a
 * separate change with deploy risk, deliberately not bundled into a test PR.
 *
 * Import this module for side effects BEFORE dynamically importing anything in
 * the functions/ graph:
 *
 *   import './_json-module-hook.mjs';
 *   const webhook = await import('../functions/api/stripe-webhook.js');
 */
import { registerHooks } from 'node:module';

/** Minimal course catalogue. Ids/slugs are fixture-owned, never real content. */
export const COURSE_FIXTURE = [
  {
    id: 'test-course-basic',
    slug: 'test-course-basic',
    title: 'Test Course: Basic',
    status: 'published',
    access_type: 'public',
    price: 4900,
    sections: [
      { id: 'sec-1', title: 'Section One', steps: [{ id: 'step-1', title: 'Step One', type: 'video' }] },
    ],
  },
  {
    id: 'test-course-bundle',
    slug: 'test-course-bundle',
    title: 'Test Course: Bundle',
    status: 'published',
    access_type: 'public',
    price: 19900,
    sections: [
      { id: 'sec-2', title: 'Section Two', steps: [{ id: 'step-2', title: 'Step Two', type: 'video' }] },
    ],
  },
];

const FIXTURES = new Map([
  ['src/data/courses.json', COURSE_FIXTURE],
  ['src/data/quizzes.json', {}],
  ['src/data/og-index.json', {}],
]);

const REPO_ROOT = new URL('../', import.meta.url);
const fixtureByUrl = new Map(
  [...FIXTURES].map(([rel, value]) => [new URL(rel, REPO_ROOT).href, JSON.stringify(value)])
);

registerHooks({
  resolve(specifier, context, next) {
    // Short-circuit BEFORE the default resolver, which stats the file and
    // throws ERR_MODULE_NOT_FOUND. src/data/courses.json is gitignored, so on a
    // clean CI checkout it does not exist and a load-only hook never runs.
    // Verified by deleting the file locally and re-running the suite.
    if (specifier.endsWith('.json') && context.parentURL) {
      let href;
      try { href = new URL(specifier, context.parentURL).href; } catch { href = null; }
      if (href && fixtureByUrl.has(href)) {
        return { url: href, format: 'json', importAttributes: { type: 'json' }, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },

  load(url, context, next) {
    if (!url.endsWith('.json')) return next(url, context);
    const fixture = fixtureByUrl.get(url);
    if (fixture !== undefined) {
      return { format: 'json', source: fixture, shortCircuit: true };
    }
    // Real JSON file: pass through, but declare the attribute the source omitted.
    return next(url, { ...context, importAttributes: { type: 'json' } });
  },
});

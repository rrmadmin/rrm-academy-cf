/**
 * console.config.mjs -- this repo's declaration to console-kit.
 *
 * rrm-academy-cf is NOT an Access-gated Next console, so it declares
 * `kitScope: 'packages'`: the kit writes `vendor/<name>/**` and the packages
 * half of kit.lock.json here and nothing else. No _headers, no admin.js, no
 * Next config; the Astro site's own build owns all of that.
 *
 * It vendors two packages. `mail` is the estate's one outbound
 * sender, and it was merged out of nine hand-rolled ones, this repo's
 * `functions/api/_ses.js` first among them. Vendoring it back is what makes
 * the lane rules -- above all the refusal that keeps RRM community, member
 * and newsletter mail off SES, and the two named exemptions Brian ruled on
 * 2026-09-09 -- enforcement here rather than convention. `redteam` is the
 * dependency gate and the red-team reporting primitives, which
 * scripts/redteam/ carried private copies of until 2026-09-09; the gate was
 * byte-identical in five repos, so its policy is one file now.
 *
 * `canonicalHost` is required of every consumer and is the site's own apex.
 * Nothing in packages scope interpolates it into generated source (there are
 * no generated files here at all), but the kit vets it as though there were.
 */
export default {
  entity: 'RRM Academy',
  console: 'rrm-academy-cf',
  canonicalHost: 'rrmacademy.org',
  kitScope: 'packages',
  packages: ['mail', 'redteam'],
};

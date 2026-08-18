# GA4 paid attribution for the first-party beacon

**Date:** 2026-08-18
**Spec:** `docs/superpowers/specs/2026-05-15-client-analytics-spec.html` §15.2 (already lists `paid` as an `entry_category` value; never implemented) + §15.7 (UTM convention).
**Branch:** `claude/ga4-paid-attribution` (worktree `.worktrees/ga4-paid-attribution`)

## Problem (measured 2026-08-18)

GA4 property 526304690 has zero paid sessions in any dimension since the 06-23 beacon shipped, while the Ad Grants account 426-226-8858 delivered 108 clicks (06-01 to 08-17). Every ad final URL carries `utm_source=google&utm_medium=cpc&utm_campaign=...&utm_content={creative}` plus an auto-tagged `gclid`, and `BaseLayout.astro` stores that full landing URL in the `entry_url` cookie on first load. Server-side, `buildSourceParams()` in `functions/api/_ga4-source.js` parses those UTMs into `utmParams` and then ignores them for classification: `classifySource()` branches only on referrer hostname, and the only medium-driven override is `utm_source === 'email'`. Result: an ad click with no referrer classifies `direct/direct`; one with a google.com referrer classifies `organic/google`. Proof: `/endo-quiz/results/` (ads-only funnel page) shows 44 events filed `organic/google` in the last 30 days.

Second gap: on the beacon branch of `sendGA4Event()` (`functions/api/_ga4.js`, `overrides.client_id && overrides.session_id`), the cookie fallback forwards only `entry_category`/`entry_platform` from `buildSourceParams()`. `utm_campaign`, `utm_content`, `email_type`, `list_source` are computed and dropped, so no page_view can be sliced by campaign or creative.

Native GA4 channel groups (`sessionDefaultChannelGroup`, `sessionSourceMedium`) cannot be repaired without a tag (session_start is a reserved MP event); Brian ruled 2026-08-18: fix the first-party classifier, keep the tag out.

## Global Constraints

- G1. `classifySource(referrer)` keeps its signature and behavior. `create-checkout.js` and `courses/enroll.js` call it and are OUT OF SCOPE for this branch (follow-up).
- G2. `fbclid` is NOT a paid signal (Facebook appends it to every outbound click, organic posts included). Only `gclid`, `gbraid`, `wbraid` (Google) and `msclkid` (Microsoft) are paid click ids.
- G3. Paid medium regex is GA4's own default-channel-group definition, verbatim: `/^(.*cp.*|ppc|retargeting|paid.*)$/i`.
- G4. Precedence inside `buildSourceParams`: existing email override runs first, then the paid override, so a click id or paid medium wins over `utm_source=email`.
- G5. `session_id` on the beacon branch is ALWAYS the client's `overrides.session_id`; the server-derived `session_id` from `buildSourceParams` is never forwarded.
- G6. Client-supplied `utm_*`, `entry_*`, `email_type`, `list_source` stay in `RESERVED_PARAMS` and are still dropped by `/api/track`; only server-derived values reach GA4. `page_location` still egresses with no query string or hash.
- G7. New param names emitted to GA4: `utm_campaign`, `utm_content` (both to be registered as event-scoped custom dimensions). Names stay `utm_*` to match the existing server-conversion path (`buildSourceParams` return shape), no renaming.
- G8. Value convention per spec §15.7: lowercase, underscore, ASCII for our own literals (gate AG6). Ad platform names emitted as `entry_platform` are canonical lowercase: `google`, `bing`.
- G9. Tests: `node --experimental-strip-types --test test/ga4-source.test.js test/track-endpoint.test.js` must pass; `npm test` (4618 tests baseline, 0 fail) must pass; `node scripts/gates/validate-analytics-pipeline.mjs` must still pass (7 warnings baseline). `npm run lint` clean on `functions/`.
- G10. Commit messages are written to a file and committed with `git commit -F <file>`; never a long `-m` (global hook doctrine). Never bypass the pre-commit hooks; if a hook blocks, fix the finding and report it.
- G11. No em dashes in code comments or docs.

## Task 1: paid classifier in `_ga4-source.js`

Files: `functions/api/_ga4-source.js`, `test/ga4-source.test.js`.

Add, after `extractUtm`, a pure exported function and two module constants:

```js
// Paid click identifiers, keyed by ad platform. fbclid is deliberately absent:
// Facebook appends it to every outbound click, organic posts included, so it
// is not evidence the visit was bought.
const PAID_CLICK_IDS = [
  { param: 'gclid',   platform: 'google' },
  { param: 'gbraid',  platform: 'google' },
  { param: 'wbraid',  platform: 'google' },
  { param: 'msclkid', platform: 'bing' },
];

// GA4's own default-channel-group definition of a paid medium.
const PAID_MEDIUM_RE = /^(.*cp.*|ppc|retargeting|paid.*)$/i;

/**
 * Detects a bought visit from the entry URL: an ad-platform click id
 * (gclid/gbraid/wbraid/msclkid) or a paid utm_medium. Referrer-only
 * classification cannot see this: Google Ads clicks arrive with an empty
 * or google.com referrer and would file as direct/organic.
 *
 * Returns null when the URL carries no paid signal, otherwise
 * { source, medium, entry_category: 'paid', entry_platform } where
 * entry_platform is the click id's canonical platform when a click id is
 * present, else lowercased utm_source, else null (caller keeps its
 * referrer-derived platform).
 */
export function classifyPaid(urlString, utmParams = extractUtm(urlString)) {
  let params;
  try {
    params = new URL(urlString).searchParams;
  } catch {
    params = new URLSearchParams();
  }
  const clickId = PAID_CLICK_IDS.find(({ param }) => params.get(param));
  const paidMedium = typeof utmParams.utm_medium === 'string' && PAID_MEDIUM_RE.test(utmParams.utm_medium);
  if (!clickId && !paidMedium) return null;

  const utmSource = typeof utmParams.utm_source === 'string' && utmParams.utm_source
    ? utmParams.utm_source.toLowerCase()
    : null;
  const entry_platform = clickId ? clickId.platform : utmSource;
  return {
    source: utmSource || entry_platform || '(paid)',
    medium: paidMedium ? utmParams.utm_medium : 'cpc',
    entry_category: 'paid',
    entry_platform,
  };
}
```

In `buildSourceParams`, directly AFTER the existing email override block (the `if (utmParams.utm_source === 'email') { ... }`), add:

```js
  // Paid override: a click id or paid utm_medium in the entry URL means the
  // visit was bought regardless of referrer. Runs after the email override so
  // a paid click always wins over utm_source=email.
  const paid = classifyPaid(url, utmParams);
  if (paid) {
    classified.source = paid.source;
    classified.medium = paid.medium;
    classified.entry_category = paid.entry_category;
    if (paid.entry_platform) classified.entry_platform = paid.entry_platform;
  }
```

Note `url` is already `entryUrl || request.url` at that point and `utmParams` is already `extractUtm(url)`. The return object needs no change: `utm_source: utmParams.utm_source || classified.source` and `utm_medium: utmParams.utm_medium || classified.medium` already prefer the literal UTM values.

Tests to add in `test/ga4-source.test.js` (import `classifyPaid`):

`describe('classifyPaid')`:
1. returns null for a URL with no query string.
2. returns null for organic-looking utm (`utm_source=newsletter&utm_medium=email`).
3. `gclid` alone -> `{ entry_category: 'paid', entry_platform: 'google', medium: 'cpc', source: 'google' }`.
4. `gbraid` -> platform google; `wbraid` -> platform google; `msclkid` -> platform bing.
5. `fbclid` alone -> null (G2).
6. `utm_medium=cpc&utm_source=gads` (no click id) -> paid, entry_platform 'gads', source 'gads', medium 'cpc'.
7. `utm_medium=paid_social&utm_source=Instagram` -> paid, entry_platform 'instagram' (lowercased), medium 'paid_social'.
8. `utm_medium=ppc` and `utm_medium=retargeting` and `utm_medium=display_cpm` (matches `.*cp.*`) -> paid.
9. `utm_medium=cpc` with no utm_source and no click id -> paid, entry_platform null, source '(paid)'.
10. click id + `utm_source=gads` -> entry_platform 'google' (click id wins over free-text source), source 'gads'.
11. `gclid=` (empty value) -> null (an empty click id is not a click id).
12. malformed URL string -> null (no throw).

`describe('buildSourceParams paid override')` using the existing `fakeRequest` helper pattern in that file:
13. `entry_url` cookie = `https://rrmacademy.org/endo-quiz/?utm_source=google&utm_medium=cpc&utm_campaign=google_ads_endometriosis_symptom_quiz_2026-q3&utm_content=818477153915&gclid=EAIaIQobChMI-test` with `entry_ref` cookie empty -> `entry_category 'paid'`, `entry_platform 'google'`, `utm_source 'google'`, `utm_medium 'cpc'`, `utm_campaign` and `utm_content` as given.
14. same cookie but `entry_ref` = `https://www.google.com/` -> still `paid`/`google` (paid beats organic).
15. `entry_url` with `gclid` and `utm_source=email&utm_medium=newsletter` -> `entry_category 'paid'` (G4), and `email_type` is still whatever the email override set (do not strip it; assert `email_type === 'broadcast'`).
16. `entry_url` = `https://rrmacademy.org/?fbclid=abc` with instagram `entry_ref` -> `social`/`instagram` (unchanged).
17. `entry_url` = `https://rrmacademy.org/?utm_medium=cpc` (no source, no click id), `entry_ref` empty -> `entry_category 'paid'`, `entry_platform 'direct'` (falls back to referrer-derived platform).
18. Existing test "uses entry_url cookie for UTM extraction" (`utm_source=gads&utm_medium=cpc`) must keep passing unchanged and now also yields `entry_category 'paid'`; extend that test with the two new assertions rather than duplicating it.

## Task 2: forward the attribution set on the beacon branch + AE hint enum

Files: `functions/api/_ga4.js`, `functions/api/track.js`, `test/track-endpoint.test.js`.

In `functions/api/_ga4.js`, inside the beacon branch (`overrides.client_id != null && overrides.session_id != null`), replace the two `if (params.entry_category == null && derived.entry_category) ...` / `if (params.entry_platform == null && derived.entry_platform) ...` lines with forwarding of the whole attribution set minus `session_id`:

```js
          const derived = await buildSourceParams(request, clientId);
          // Forward everything buildSourceParams knows about the visit except
          // its server-derived session_id: the client's session_id (overrides)
          // is the real one and must win. Caller params still spread last in
          // the payload, so a caller-supplied value is never clobbered here.
          const { session_id: _serverSessionId, ...attribution } = derived;
          Object.assign(sourceParams, attribution);
```

Keep the surrounding trigger condition (`if (params.entry_category == null || params.entry_platform == null)` and the cookie presence check) exactly as is. Update the comment block above it so it no longer says only entry_category/entry_platform are forwarded (it now says: the full attribution set: `entry_*`, `utm_*`, `email_type`, `list_source`). If eslint's `no-unused-vars` complains about `_serverSessionId`, use whichever pattern sibling files in `functions/api/` already use for an intentionally-unused destructure (check `.eslintrc*`/`eslint.config.*` for `varsIgnorePattern`); if none exists, delete the key from a shallow copy instead (`const attribution = { ...derived }; delete attribution.session_id;`).

In `functions/api/track.js`, add `'paid'` to `ENTRY_CATEGORY_VALUES` and update the comment so it lists `paid` (the comment says the set mirrors what `classifySource()`/`buildSourceParams()` emit; that is now true again). No other track.js change.

Tests to add in `test/track-endpoint.test.js`. Extend `makeFetchStub()` so it also records the parsed JSON body of each google-analytics.com call (`state.bodies.push(JSON.parse(init.body))`, capturing the second fetch argument); keep `callCount` behavior. New `describe('POST /api/track -- beacon attribution forwarding')`:

1. page_view with `cid` (a UUID), `sid` (an integer epoch seconds), `sn: 1`, params `{ page_location: 'https://rrmacademy.org/endo-quiz/?utm_source=google&utm_medium=cpc&gclid=x', page_referrer: '' }`, and a `Cookie` header `entry_ref=; entry_url=<encodeURIComponent('https://rrmacademy.org/endo-quiz/?utm_source=google&utm_medium=cpc&utm_campaign=google_ads_endometriosis_symptom_quiz_2026-q3&utm_content=818477153915&gclid=EAIaIQobChMI-test')>`. After `await Promise.all(ctx.waitUntil.promises)`, assert on the captured MP body: `client_id === cid`; `events[0].params.session_id === sid`; `session_number === 1`; `entry_category === 'paid'`; `entry_platform === 'google'`; `utm_medium === 'cpc'`; `utm_campaign === 'google_ads_endometriosis_symptom_quiz_2026-q3'`; `utm_content === '818477153915'`; `page_location === 'https://rrmacademy.org/endo-quiz/'` (query stripped, G6).
2. Same request but the client also sends `utm_campaign: 'client_spoof'` and `entry_category: 'organic'` inside params -> body has `utm_campaign` equal to the cookie value and `entry_category 'paid'` (client values dropped, G6).
3. `entry_ref` = `https://www.google.com/` and `entry_url` = `https://rrmacademy.org/library/` (no utm, no click id) -> `entry_category 'organic'`, `entry_platform 'google'`, and `utm_campaign`/`utm_content` keys are ABSENT from the body.
4. No cookies at all -> body has no `entry_category`, `entry_platform`, `utm_campaign` keys (unchanged behavior) and `session_id === sid`.
5. `entry_url` = `https://rrmacademy.org/?utm_source=email&utm_medium=newsletter&list_source=endo_survey_signup` plus a `list_source=endo_survey_signup` cookie -> body has `entry_category 'email'`, `email_type 'broadcast'`, `list_source 'endo_survey_signup'` (the previously dropped keys now forwarded).
6. AE hint: `cta_click` with params `entry_category: 'paid'` -> `writeDataPoint` blob[2] === 'paid' (mirrors the existing enum-hint test at the "AE writeDataPoint blobs carry entry_category/device_type hints" case).

## Task 3: registration script, gate parity, spec addendum

Files: `scripts/ga4-phase4-config.mjs`, `scripts/gates/validate-analytics-pipeline.mjs`, `docs/superpowers/specs/2026-05-15-client-analytics-spec.html`.

1. `scripts/ga4-phase4-config.mjs`: append two rows to `CUSTOM_DIMENSIONS`:
   `['UTM Campaign', 'utm_campaign', 'EVENT', 'utm_campaign from the entry URL (Google Ads final_url_suffix, email links)']` and
   `['UTM Content', 'utm_content', 'EVENT', 'utm_content from the entry URL ({creative} ad id on Google Ads)']`.
   Update the header comment count "Creates 13 custom dimensions" to 15 and add the two names to that list.
2. `scripts/gates/validate-analytics-pipeline.mjs` AG12 `SPEC_DIMS`: append `'utm_campaign'`, `'utm_content'`.
3. Spec HTML: in the §15.2 table (`<h3>15.2 Custom dimensions to register in GA4</h3>`), append two `<tr>` rows before `</tbody>` for `utm_campaign` (event-scoped, source param `utm_campaign`, why: campaign name from the entry URL; Google Ads `final_url_suffix` and email links) and `utm_content` (event-scoped, `utm_content`, why: creative/ad id from the entry URL; `{creative}` on Google Ads). Directly after the table add one paragraph: `<p><strong>Addendum 2026-08-18:</strong> <code>entry_category = paid</code> is now emitted: <code>buildSourceParams()</code> classifies a visit as paid when the entry URL carries a Google/Microsoft click id (<code>gclid</code>, <code>gbraid</code>, <code>wbraid</code>, <code>msclkid</code>) or a paid <code>utm_medium</code> (GA4's own <code>^(.*cp.*|ppc|retargeting|paid.*)$</code>). <code>fbclid</code> is not a paid signal. The beacon branch of <code>sendGA4Event()</code> forwards the full attribution set (<code>entry_*</code>, <code>utm_*</code>, <code>email_type</code>, <code>list_source</code>) instead of only <code>entry_category</code>/<code>entry_platform</code>. Native GA4 channel groups stay Unassigned by design (no tag).</p>`. Also update the line `<li><strong>Register 13 custom dimensions</strong> (§15.2)` to 15.
4. Run `node scripts/gates/validate-analytics-pipeline.mjs --gate AG12` and confirm the two new dims report as present.

## Out of scope (recorded, not built)

- `create-checkout.js` / `courses/enroll.js` still classify by referrer only (purchase/enroll from a paid click stays organic/direct). Follow-up: call `classifyPaid(entry_url)` there; both already receive `entry_url`.
- Registering the two dimensions in GA4 (run `scripts/ga4-phase4-config.mjs`) and deploying: Brian's go.
- Historical Unassigned sessions are not repaired; GA4 does not reprocess.

// scripts/lib/cta-map-rules.mjs
// Shared rule implementations for scripts/check-cta-map.mjs.
//
// SOURCE MODE (cheap, non-enforcing on missing attributes): a data-cta
// written as a literal string must validate; a component file must not
// define the same literal data-cta twice. It cannot see whether an
// unadorned element without data-cta is money-shaped -- Astro conditionals
// and JS-built attribute values make that undecidable from source text --
// so it never tries.
//
// DIST MODE (enforcing): runs against dist/**/*.html, where every href is
// resolved, every conditional has picked its one branch, and every element
// is real markup. Implements rule 2 (target match), rule 2b (element-
// scoped JS-wired button/form), rule 3 (per-page duplicate), and the
// cta-required-ids.json coverage check.
//
// Spec: docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md §4.3

import { validateCtaId } from './cta-vocabulary.mjs';

// --------------------------------------------------------------- source ---

// Matches a LITERAL data-cta value only: data-cta="x.y.z" or data-cta='x.y.z'.
// Deliberately does NOT match data-cta={expr} -- an Astro expression's
// runtime value cannot be judged from source text, so source mode is silent
// on it. Rule 2/2b enforcement of those elements happens in dist mode,
// where the expression has already resolved to a real attribute value.
const LITERAL_CTA_RE = /\sdata-cta\s*=\s*["']([^"'{}]+)["']/g;

/** Every literal data-cta value in one file, in document order. */
export function extractLiteralCtaValues(source) {
  const out = [];
  let m;
  LITERAL_CTA_RE.lastIndex = 0;
  while ((m = LITERAL_CTA_RE.exec(source)) !== null) out.push(m[1]);
  return out;
}

/** Source-mode check (a): every literal data-cta value validates. */
export function checkLiteralCtaValidity(filePath, source) {
  const violations = [];
  for (const ctaId of extractLiteralCtaValues(source)) {
    const validity = validateCtaId(ctaId);
    if (!validity.ok) violations.push({ filePath, id: ctaId, reason: validity.reason });
  }
  return violations;
}

// A source-text regex scan cannot see that two occurrences sit in mutually
// exclusive Astro branches (`isMembers ? <A data-cta="x"/> : <B data-cta="x"/>`)
// -- that requires actually parsing the conditional, which this scanner
// deliberately does not do (see the module header). Dist mode's rule 3
// already enforces the real invariant this check is a proxy for (no
// data-cta duplicated on one RENDERED page) correctly, because only one
// branch ever ships to a given page's HTML. This narrow, explicit allowlist
// lets one file's KNOWN, deliberately-shared id through source mode without
// weakening the check for every other accidental duplicate. Add an entry
// only when the id is intentionally repeated across branches that can never
// both render on the same page -- verify that with dist mode, not by adding
// entries here to silence a real duplicate.
const INTENTIONALLY_SHARED_ACROSS_EXCLUSIVE_BRANCHES = new Map([
  // courses/[slug].astro hero: mutually exclusive isMembers/isFree branches
  // for "Start Learning" / "Enroll Now" and for the two "Log in" links,
  // never both rendered on one page.
  ['src/pages/courses/[slug].astro', new Set(['course.hero.course-enroll', 'course.hero.login'])],
]);

/** Source-mode check (b): no literal data-cta value repeated within one file. */
export function checkComponentDuplicates(filePath, source) {
  const violations = [];
  const seen = new Map();
  const exempt = INTENTIONALLY_SHARED_ACROSS_EXCLUSIVE_BRANCHES.get(filePath) || new Set();
  for (const ctaId of extractLiteralCtaValues(source)) {
    if (exempt.has(ctaId)) continue;
    seen.set(ctaId, (seen.get(ctaId) || 0) + 1);
    if (seen.get(ctaId) === 2) {
      violations.push({ filePath, id: ctaId, reason: `data-cta "${ctaId}" is defined more than once within this single component file` });
    }
  }
  return violations;
}

// ----------------------------------------------------------------- dist ---

// Rule 2: rendered href/action value match OR trigger-attribute presence OR
// an <a> whose rel contains "sponsored". Scoped to MONEY (/donate,
// /api/create-checkout, /api/billing/portal, /save-the-uterus-club) and LEAD
// CAPTURE (the /api/newsletter, /api/endo-quiz, /api/survey, /api/courses
// endpoints, rel=sponsored, mailto:) targets only. Navigation targets
// (account, login, signup, the provider directory) are NOT policed here --
// they are not money or lead capture, they are chrome navigation. Chrome
// links to them (Header, nav-mobile, homepage) still carry data-cta, but by
// choice, not because this rule requires it (controller ruling, 2026-09-05).
export const TARGET_PATH_PATTERNS = [
  /^\/donate\/?/,
  /^\/api\/create-checkout/,
  /^\/api\/billing\/portal/,
  /^\/save-the-uterus-club\/?/,
  /^\/api\/newsletter\/subscribe/,
  /^\/api\/endo-quiz\//,
  /^\/api\/survey\//,
  /^\/api\/courses\/enroll/,
  /^\/api\/courses\/waitlist/,
  /^mailto:/,
];

// data-course-id is deliberately NOT here (see Global Constraints): the
// real enroll buttons are caught by rule 2b's class-reference form instead.
export const TRIGGER_ATTRS = ['data-tier', 'data-checkout', 'data-enroll'];

// Rule 2b's literal set: an inline <script> element containing one of these
// is presumed to be doing money/lead work.
export const RULE_2B_LITERALS = [
  '/api/create-checkout',
  '/api/billing/portal',
  'mailto:',
  '/api/newsletter/subscribe',
  '/api/endo-quiz/',
  '/api/survey/',
  '/api/courses/enroll',
  '/api/courses/waitlist',
];

/** Extracts every <script>...</script> body as its OWN entry -- never joined. */
export function extractInlineScripts(html) {
  const scripts = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) scripts.push(m[1]);
  return scripts;
}

function attr(attrsRaw, name) {
  const m = attrsRaw.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`));
  return m ? m[1] : null;
}

// The trailing alternative also matches end-of-string: attrsRaw is captured
// via `[^>]*` (never includes the closing `>`), so a boolean attribute that
// is the LAST thing on a tag (e.g. `<button data-newsletter-btn>`) ends the
// string right after its name, with no `>` or whitespace left to match.
function hasAttrPresence(attrsRaw, name) {
  return new RegExp(`\\s${name}(\\s*=|[\\s>]|$)`).test(attrsRaw);
}

/** True when an <a>/<form>'s own target is absent, empty, #, or javascript:. */
function hasNoRealTarget(tag, attrsRaw) {
  const value = tag === 'form' ? attr(attrsRaw, 'action') : attr(attrsRaw, 'href');
  return value == null || value === '' || value === '#' || value.startsWith('javascript:');
}

/**
 * Does ANY script element (checked one at a time, per the element-scoped
 * design) have a click/submit HANDLER OF ITS OWN that contains a
 * RULE_2B_LITERALS literal? "Its own handler" -- not merely "referenced
 * somewhere in a script that also contains a literal" -- is the only
 * signal that survives a real multi-purpose script: on account/index.astro
 * (one 20KB `<script is:inline>` covering logout/profile/password/billing),
 * the genuinely billing-wired reference
 * (`getElementById('manage-billing-btn').addEventListener('click', ...)`,
 * the fetch immediately inside that handler) and thirteen UNRELATED ids
 * referenced elsewhere in the same tag are otherwise indistinguishable by
 * raw proximity alone -- two disclosure-toggle buttons merely passed as
 * arguments to an unrelated `renderHistoryList(...)` call sit CLOSER to the
 * billing literal (464/737 chars) than `#fund-give-btn` on /providers/
 * sits from its own genuinely-wired handler (2,561 chars, `var giveBtn =
 * document.getElementById(...)` followed by unrelated UI setup code before
 * `giveBtn.addEventListener('click', ...)` finally fetches
 * `/api/create-checkout`). Raw character distance cannot separate these;
 * tracing the SPECIFIC handler attached to THIS element's own reference can.
 */
const HANDLER_BODY_WINDOW = 800;

function allMatchPositions(script, needle) {
  const positions = [];
  let idx = script.indexOf(needle);
  while (idx !== -1) {
    positions.push(idx);
    idx = script.indexOf(needle, idx + 1);
  }
  return positions;
}

function withinWindowOfAnyLiteral(script, literalPositions, refPositions, window = HANDLER_BODY_WINDOW) {
  for (const refPos of refPositions) {
    for (const litPos of literalPositions) {
      if (Math.abs(refPos - litPos) <= window) return true;
    }
  }
  return false;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Every place a "self" reference chains into an actual handler: an
// EventTarget listener, or a direct on* assignment (both are real DOM
// wiring; onclick/onsubmit are the two this codebase actually uses).
const HANDLER_CHAIN_SUFFIXES = ['\\.\\s*addEventListener\\s*\\(', '\\.\\s*onclick\\s*=', '\\.\\s*onsubmit\\s*='];

/**
 * Finds every position right after a handler-chain (addEventListener(,
 * onclick=, onsubmit=) attached to one of `selfPatterns` (regex SOURCE
 * strings, e.g. `getElementById\\('id'\\)` or an escaped variable name).
 */
function handlerStartsForSelves(script, selfPatterns) {
  const starts = [];
  for (const self of selfPatterns) {
    for (const suffix of HANDLER_CHAIN_SUFFIXES) {
      const re = new RegExp(`(?:${self})\\s*${suffix}`, 'g');
      let m;
      while ((m = re.exec(script)) !== null) starts.push(m.index + m[0].length);
    }
  }
  return starts;
}

/** getElementById('id') / querySelector('#id'), direct-chain OR assigned to a variable. */
function idHandlerContainsLiteral(script, id, literalPositions) {
  const idEsc = escapeRegExp(id);
  const directPatterns = [`getElementById\\(['"]${idEsc}['"]\\)`, `document\\s*\\.\\s*querySelector\\(['"]#${idEsc}['"]\\)`];
  const declRe = new RegExp(`(?:var|let|const)\\s+(\\w+)\\s*=\\s*document\\s*\\.\\s*(?:getElementById\\(['"]${idEsc}['"]\\)|querySelector\\(['"]#${idEsc}['"]\\))`);
  const declMatch = script.match(declRe);
  const selfPatterns = [...directPatterns];
  // \b-anchored: a bare variable name must not match as a substring of a
  // longer identifier (e.g. `giveBtn` inside `giveBtnFoo.addEventListener`).
  if (declMatch) selfPatterns.push(`\\b${escapeRegExp(declMatch[1])}\\b`);
  const starts = handlerStartsForSelves(script, selfPatterns);
  return starts.some((start) => withinWindowOfAnyLiteral(script, literalPositions, [start]));
}

/**
 * A `.cls`/`[data-x]` selector match via querySelector(All). Compound
 * selectors (`.enroll-btn.primary`, `[data-newsletter-btn].active`) are
 * matched by allowing any non-quote suffix after the leading token --
 * the selector merely needs to START with it.
 *
 * `allowFallback` controls whether a BARE reference with no real handler
 * chain (no forEach, no addEventListener/onclick/onsubmit, no variable
 * later given one) still counts, anchored on the reference site itself.
 * This is deliberately a separate, weaker signal from a genuine own
 * handler -- see the tagged-form-submit exemption in findDistModeViolations,
 * which needs to tell "merely referenced nearby" apart from "has its own
 * real click/submit wiring" even though both count as "in scope for 2b"
 * when NOT inside an already-tagged form.
 */
function selectorHandlerContainsLiteral(script, selectorPrefixSrc, literalPositions, { allowFallback = true } = {}) {
  const queryCallSrc = `(?:[\\w$]+\\s*\\.\\s*)?querySelector(All)?\\(['"]${selectorPrefixSrc}[^'"]*['"]\\)`;
  const declRe = new RegExp(`(?:var|let|const)\\s+(\\w+)\\s*=\\s*${queryCallSrc}`);
  const declMatch = script.match(declRe);
  const starts = [];
  if (declMatch) starts.push(...handlerStartsForSelves(script, [`\\b${escapeRegExp(declMatch[1])}\\b`]));

  const queryRe = new RegExp(queryCallSrc, 'g');
  let m;
  while ((m = queryRe.exec(script)) !== null) {
    const isAll = !!m[1];
    if (isAll) {
      const afterQuery = script.slice(m.index + m[0].length);
      const forEachMatch = afterQuery.match(/^\s*\.\s*forEach\s*\(\s*function\s*\([^)]*\)\s*\{/);
      if (forEachMatch) {
        starts.push(m.index + m[0].length + forEachMatch[0].length);
        continue;
      }
    }
    starts.push(...handlerStartsForSelves(script, [escapeRegExp(m[0])]));
  }

  if (starts.length === 0 && allowFallback) {
    queryRe.lastIndex = 0;
    while ((m = queryRe.exec(script)) !== null) starts.push(m.index + m[0].length);
  }
  return starts.some((start) => withinWindowOfAnyLiteral(script, literalPositions, [start]));
}

function isWiredToMoneyLiteral(scripts, id, dataAttrNames, classNames, { allowFallback = true } = {}) {
  for (const script of scripts) {
    const literalPositions = RULE_2B_LITERALS.flatMap((lit) => allMatchPositions(script, lit));
    if (literalPositions.length === 0) continue;
    if (id && idHandlerContainsLiteral(script, id, literalPositions)) return true;
    for (const name of dataAttrNames) {
      if (selectorHandlerContainsLiteral(script, `\\[${escapeRegExp(name)}`, literalPositions, { allowFallback })) return true;
    }
    for (const cls of classNames) {
      if (selectorHandlerContainsLiteral(script, `\\.${escapeRegExp(cls)}`, literalPositions, { allowFallback })) return true;
    }
  }
  return false;
}

/** Extracts every data-*="..." attribute name (not value) present on a tag. */
function dataAttrNamesOf(attrsRaw) {
  const names = [];
  // Same end-of-string allowance as hasAttrPresence, above.
  const re = /\s(data-[a-z0-9-]+)(?:\s*=|[\s>]|$)/g;
  let m;
  while ((m = re.exec(attrsRaw)) !== null) if (m[1] !== 'data-cta') names.push(m[1]);
  return names;
}

/** Extracts a tag's class list, split on whitespace. */
function classNamesOf(attrsRaw) {
  const m = attrsRaw.match(/\sclass\s*=\s*["']([^"']*)["']/);
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

// Blanks out every <script>...</script> BODY (keeping the tags themselves
// and the string length, so nothing downstream needs re-indexing) before
// the outer <a|button|form> scan runs. Several course lesson pages build
// login/signup/membership links at runtime via innerHTML string
// concatenation -- e.g. `'<a href="/login/?redirect=' + dest + '">Log in</a>'`
// inside an inline <script>. That JS source text matches the same
// `<a ...>` shape a real rendered element would, and without this strip
// the outer scan misidentifies hundreds of JS string literals per page as
// untagged money elements. Rule 2b's own script analysis is unaffected --
// it calls extractInlineScripts() on the ORIGINAL html, separately.
export function stripScriptBodies(html) {
  return html.replace(/(<script[^>]*>)([\s\S]*?)(<\/script>)/g, (_, open, body, close) => open + ' '.repeat(body.length) + close);
}

// Byte ranges of every <form ...data-cta="...">...</form> block, for the
// "submit button belongs to an already-tagged form" exemption below. A
// form's own submit button is often given its own id/data-*/class for
// OTHER purposes (disabling during submit, feedback wiring) that happen to
// be queried in the same script as the form's fetch -- that alone should
// not force a second, redundant tag on the button when the form already
// carries one (spec intent, stated explicitly for the newsletter/quiz/
// survey/waitlist forms: "the click bubbles to closest('[data-cta]') on
// the ancestor form"). Regex-nested, not a real parser -- assumes forms in
// this codebase don't nest (true today).
function taggedFormRanges(html) {
  const ranges = [];
  const re = /<form\b[^>]*\sdata-cta\s*=\s*["'][^"']+["'][^>]*>[\s\S]*?<\/form>/g;
  let m;
  while ((m = re.exec(html)) !== null) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

function isWithinRanges(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

// Byte ranges of every element carrying `data-cta-content` (an authored
// content body -- commentary and library bodies, guide and FAQ bodies,
// course step bodies), for the "in-prose link is copy, not a CTA" exemption
// (spec §4.3). Regex-nested like taggedFormRanges, tracking depth by the
// SAME tag name so a `<div data-cta-content>` body containing nested divs
// is not truncated at the first inner `</div>`.
export function contentBodyRanges(html) {
  const ranges = [];
  const openRe = /<([a-z][\w-]*)\b([^>]*)>/g;
  let m;
  while ((m = openRe.exec(html)) !== null) {
    const [, tagName, attrsRaw] = m;
    if (!hasAttrPresence(attrsRaw, 'data-cta-content')) continue;
    const start = m.index;
    const nestedRe = new RegExp(`<(/?)${tagName}\\b[^>]*>`, 'g');
    nestedRe.lastIndex = openRe.lastIndex;
    let depth = 1;
    let end = html.length;
    let mm;
    while ((mm = nestedRe.exec(html)) !== null) {
      if (mm[1] === '/') {
        depth--;
        if (depth === 0) {
          end = mm.index + mm[0].length;
          break;
        }
      } else {
        depth++;
      }
    }
    ranges.push([start, end]);
    openRe.lastIndex = end;
  }
  return ranges;
}

/**
 * Runs rules 2 and 2b against one rendered page's HTML. `html` is the FULL
 * page (dist mode's unit is a whole rendered file, not a component).
 */
export function findDistModeViolations(pagePath, html, requiredIdSet) {
  const violations = [];
  const scripts = extractInlineScripts(html);
  const outerScanHtml = stripScriptBodies(html);
  const formRanges = taggedFormRanges(outerScanHtml);
  const contentRanges = contentBodyRanges(outerScanHtml);
  const tagRe = /<(a|button|form)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(outerScanHtml)) !== null) {
    if (isWithinRanges(m.index, contentRanges)) continue;
    const [, tag, attrsRaw] = m;
    const dataCtaMatch = attrsRaw.match(/\sdata-cta\s*=\s*["']([^"']*)["']/);
    const id = attr(attrsRaw, 'id');
    const label = id ? `#${id}` : `<${tag}>`;

    // --- Rule 2 ---
    const targetValue = tag === 'form' ? attr(attrsRaw, 'action') : attr(attrsRaw, 'href');
    const matchesTarget = targetValue && TARGET_PATH_PATTERNS.some((p) => p.test(targetValue));
    const hasTrigger = TRIGGER_ATTRS.some((a) => hasAttrPresence(attrsRaw, a));
    const relSponsored = tag === 'a' && /\srel\s*=\s*["'][^"']*\bsponsored\b/.test(attrsRaw);
    const inScopeForRule2 = !(targetValue === '/' || (targetValue || '').startsWith('javascript:')) && (matchesTarget || hasTrigger || relSponsored);

    if (inScopeForRule2) {
      if (!dataCtaMatch) {
        violations.push({ pagePath, tag, label, reason: `${label} targets a money/lead path but has no data-cta attribute` });
      } else {
        const validity = validateCtaId(dataCtaMatch[1]);
        if (!validity.ok) violations.push({ pagePath, tag, label, reason: validity.reason });
      }
      continue; // rule 2 already governs this element; rule 2b does not also apply to it
    }

    // --- Rule 2b (element-scoped; button always eligible, a/form only when target-less) ---
    const eligibleFor2b = tag === 'button' || hasNoRealTarget(tag, attrsRaw);
    if (!eligibleFor2b) continue;
    const dataAttrNames = dataAttrNamesOf(attrsRaw);
    const classNames = classNamesOf(attrsRaw);
    if (!id && dataAttrNames.length === 0 && classNames.length === 0) continue;

    if (!isWiredToMoneyLiteral(scripts, id, dataAttrNames, classNames)) continue;

    // A submit button inside an already-tagged form is exempt ONLY if its
    // own handler (if any) carries no money/lead literal of its own -- the
    // form's data-cta already covers the plain "submitting this form is
    // the conversion" case (newsletter/quiz/survey/waitlist forms). A
    // button that independently does its OWN money/lead thing (a genuine
    // addEventListener/onclick/onsubmit chain, not just a bare reference
    // used for unrelated UI state) is NOT covered by that and still needs
    // checking. Re-run with allowFallback:false to distinguish "merely
    // referenced nearby" (exempt) from "has its own real handler" (not).
    const isSubmitInTaggedForm = tag === 'button' && attr(attrsRaw, 'type') === 'submit' && isWithinRanges(m.index, formRanges);
    if (isSubmitInTaggedForm) {
      const hasOwnRealHandler = isWiredToMoneyLiteral(scripts, id, dataAttrNames, classNames, { allowFallback: false });
      if (!hasOwnRealHandler) continue;
    }

    if (!dataCtaMatch) {
      violations.push({ pagePath, tag, label, reason: `${label} is referenced from an inline script alongside a money/lead endpoint but has no data-cta attribute` });
    } else {
      const validity = validateCtaId(dataCtaMatch[1]);
      if (!validity.ok) violations.push({ pagePath, tag, label, reason: validity.reason });
    }
  }
  return violations;
}

/**
 * cta-required-ids.json coverage: every id in `requiredIdSet` must exist,
 * across ALL of `htmlPages` (already script-body-stripped by the caller),
 * carrying a valid data-cta on its OWN tag. Returns one failure message per
 * uncovered id (stale allowlist entry, or the element lost its tag).
 */
export function findRequiredIdCoverage(htmlPages, requiredIdSet) {
  const seen = new Set();
  const idTagRe = /<[a-z][\w-]*\b([^>]*)>/gi;
  for (const html of htmlPages) {
    idTagRe.lastIndex = 0;
    let idm;
    while ((idm = idTagRe.exec(html)) !== null) {
      const attrsRaw = idm[1];
      const idMatch = attrsRaw.match(/\sid\s*=\s*["']([^"']+)["']/);
      if (!idMatch || !requiredIdSet.has(idMatch[1])) continue;
      const dataCtaMatch = attrsRaw.match(/\sdata-cta\s*=\s*["']([^"']+)["']/);
      if (dataCtaMatch && validateCtaId(dataCtaMatch[1]).ok) seen.add(idMatch[1]);
    }
  }
  const failures = [];
  for (const id of requiredIdSet) {
    if (!seen.has(id)) {
      failures.push(`cta-required-ids.json: "${id}" is listed but was not found in dist/ carrying a valid data-cta (stale allowlist entry, or the element lost its tag)`);
    }
  }
  return failures;
}

/** Extracts every data-cta="..." occurrence from one rendered HTML string, in order. */
export function extractCtaOccurrences(html) {
  const out = [];
  const re = /<([a-z][\w-]*)\b[^>]*\sdata-cta\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const label = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    out.push({ tag: m[1], ctaId: m[2], label });
  }
  return out;
}

/** True when a data-cta id's page token is site-wide chrome (exempt from per-page dedup). */
export function isChromeCta(ctaId) {
  return (
    ctaId.startsWith('header.') ||
    ctaId.startsWith('footer.') ||
    ctaId.startsWith('nav-mobile.') ||
    ctaId.startsWith('app-shell.')
  );
}

// Deterministic ordering for docs/cta-map.json/.md. `localeCompare` and the
// no-comparator form of `.sort()` both resolve through the JS engine's
// locale/collation tables, which can differ across Node versions, ICU
// builds, and OS locale settings -- the exact failure mode a `--check`
// reproducibility gate cannot tolerate (CI and a laptop must produce byte-
// identical output). This is a plain UTF-16 code-unit comparator: the same
// three-way result on every engine, every locale, forever.
export function cmpCodepoint(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The digest's identity key for one row: (pageFamily, ctaId), never label/elementType/counts. */
export function digestRowKey(row) {
  return `${row.pageFamily} ${row.ctaId}`;
}

/**
 * The `--check` coverage floor: every (pageFamily, ctaId) key present in
 * `committedRows` must still exist in `freshRows`, or the gate must fail
 * naming what is missing (a template dropped a CTA). A key present in
 * `freshRows` but absent from `committedRows` is not a failure -- content
 * state can reveal a template CTA that was never rendered before (a course
 * whose closed-cohort waitlist modal only renders once a cohort actually
 * closes) -- it is reported separately so the caller can WARN and exit 0.
 * Deliberately does not compare `label`/`elementType`: those are copy and
 * change legitimately without indicating a coverage regression.
 */
export function compareDigestKeys(committedRows, freshRows) {
  const committedKeys = new Set(committedRows.map(digestRowKey));
  const freshKeys = new Set(freshRows.map(digestRowKey));
  const missing = [...committedKeys].filter((k) => !freshKeys.has(k)).sort(cmpCodepoint);
  const extra = [...freshKeys].filter((k) => !committedKeys.has(k)).sort(cmpCodepoint);
  return { missing, extra };
}

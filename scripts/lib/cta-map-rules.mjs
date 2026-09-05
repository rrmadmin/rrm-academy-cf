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
 * design) both reference this element (by id, by one of its data-*
 * attributes, or by one of its classes) AND contain a RULE_2B_LITERALS
 * literal? Returns true/false -- callers decide what that means for a
 * given tag type.
 */
// Bidirectional character window around a reference within which a
// RULE_2B_LITERALS match counts as "this element is wired to it". Chosen
// from real measured distances, not guessed: on account/index.astro's one
// 20KB multi-purpose <script> (login/logout/profile/password/billing all
// wired in the same tag), the genuinely billing-wired reference
// (`getElementById('manage-billing-btn').addEventListener('click', ...)`,
// the fetch immediately inside the handler) sits 185 chars from the
// `/api/billing/portal` literal; two disclosure-toggle buttons that are
// merely passed as arguments to an unrelated `renderHistoryList(...)` call
// physically near the billing code sit 464/737 chars away; the truly
// unrelated buttons (logout, edit-profile, change-password, resend-verify)
// sit 14,000-19,000+ chars away. 300 clears every known same-handler case
// (donate-btn, the class-wired enroll forEach, the bare
// querySelectorAll+fetch adjacent-statement shape) while excluding both
// classes of false positive on the one real multi-purpose script this
// codebase has. Without SOME window, "does the whole script contain both"
// flags every id/data-attr/class in a large script the moment it contains
// ANY money/lead literal anywhere -- proven on account/index.astro, where
// it flagged all 13 of its buttons off one `/api/billing/portal` fetch.
const WIRING_PROXIMITY_WINDOW = 300;

function allMatchPositions(script, needle) {
  const positions = [];
  let idx = script.indexOf(needle);
  while (idx !== -1) {
    positions.push(idx);
    idx = script.indexOf(needle, idx + 1);
  }
  return positions;
}

function withinWindowOfAnyLiteral(script, literalPositions, refPositions, window = WIRING_PROXIMITY_WINDOW) {
  for (const refPos of refPositions) {
    for (const litPos of literalPositions) {
      if (Math.abs(refPos - litPos) <= window) return true;
    }
  }
  return false;
}

// The proximity window above is enough for the class/data-attribute forms
// (querySelector[All] chained straight into .forEach/.addEventListener in
// every observed instance), but NOT enough for the id form: this codebase's
// pattern is `var name = document.getElementById('id');` followed, often
// hundreds or thousands of characters later, by `name.addEventListener(...)`
// -- and a proximity window around the ORIGINAL getElementById call cannot
// tell "the id's own click handler is far away but genuinely fetches the
// money endpoint" (`#fund-give-btn` on /providers/, 2561 chars from its own
// `.addEventListener` body's `/api/create-checkout` call) apart from "the id
// is declared near an unrelated element's money-wired handler" (the
// account-page disclosure toggles). The only distinguishing signal is
// finding the id's OWN addEventListener call (by variable name, or by direct
// `getElementById('id').addEventListener(...)` chaining) and checking ONLY
// that handler's body -- not the declaration site, wherever it sits.
const HANDLER_BODY_WINDOW = 800;

function ownHandlerContainsLiteral(script, id, literalPositions) {
  const varMatch = script.match(new RegExp(`(?:var|let|const)\\s+(\\w+)\\s*=\\s*document\\.getElementById\\(['"]${id}['"]\\)`));
  const selves = [id]; // covers direct chaining: getElementById('id').addEventListener(...)
  if (varMatch) selves.push(varMatch[1]);
  const handlerStarts = [];
  for (const self of selves) {
    const selfPattern = self === id ? `getElementById\\(['"]${id}['"]\\)` : self;
    const re = new RegExp(`${selfPattern}\\s*\\.\\s*addEventListener\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(script)) !== null) handlerStarts.push(m.index + m[0].length);
  }
  return handlerStarts.some((start) => withinWindowOfAnyLiteral(script, literalPositions, [start], HANDLER_BODY_WINDOW));
}

function isWiredToMoneyLiteral(scripts, id, dataAttrNames, classNames) {
  for (const script of scripts) {
    const literalPositions = RULE_2B_LITERALS.flatMap((lit) => allMatchPositions(script, lit));
    if (literalPositions.length === 0) continue;
    if (id && ownHandlerContainsLiteral(script, id, literalPositions)) return true;
    for (const name of dataAttrNames) {
      const re = new RegExp(`querySelector(?:All)?\\(['"]\\[${name}(?:[^\\]]*)?\\]`, 'g');
      const refPositions = [];
      let m;
      while ((m = re.exec(script)) !== null) refPositions.push(m.index);
      if (withinWindowOfAnyLiteral(script, literalPositions, refPositions)) return true;
    }
    for (const cls of classNames) {
      const re = new RegExp(`querySelector(?:All)?\\(['"]\\.${cls}['"]`, 'g');
      const refPositions = [];
      let m;
      while ((m = re.exec(script)) !== null) refPositions.push(m.index);
      if (withinWindowOfAnyLiteral(script, literalPositions, refPositions)) return true;
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

/**
 * Runs rules 2 and 2b against one rendered page's HTML. `html` is the FULL
 * page (dist mode's unit is a whole rendered file, not a component).
 */
export function findDistModeViolations(pagePath, html, requiredIdSet) {
  const violations = [];
  const scripts = extractInlineScripts(html);
  const outerScanHtml = stripScriptBodies(html);
  const formRanges = taggedFormRanges(outerScanHtml);
  const tagRe = /<(a|button|form)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(outerScanHtml)) !== null) {
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
    if (tag === 'button' && attr(attrsRaw, 'type') === 'submit' && isWithinRanges(m.index, formRanges)) continue;
    const eligibleFor2b = tag === 'button' || hasNoRealTarget(tag, attrsRaw);
    if (!eligibleFor2b) continue;
    const dataAttrNames = dataAttrNamesOf(attrsRaw);
    const classNames = classNamesOf(attrsRaw);
    if (!id && dataAttrNames.length === 0 && classNames.length === 0) continue;

    if (isWiredToMoneyLiteral(scripts, id, dataAttrNames, classNames)) {
      if (!dataCtaMatch) {
        violations.push({ pagePath, tag, label, reason: `${label} is referenced from an inline script alongside a money/lead endpoint but has no data-cta attribute` });
      } else {
        const validity = validateCtaId(dataCtaMatch[1]);
        if (!validity.ok) violations.push({ pagePath, tag, label, reason: validity.reason });
      }
    }
  }
  return violations;
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
  return ctaId.startsWith('header.') || ctaId.startsWith('footer.') || ctaId.startsWith('nav-mobile.');
}

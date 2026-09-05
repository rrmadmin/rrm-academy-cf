/**
 * Fixture tests for scripts/lib/cta-map-rules.mjs -- both source-mode's two
 * cheap checks and dist-mode's three enforcing rules, plus the
 * cta-required-ids.json coverage check.
 *
 * Run with: node --experimental-strip-types --test test/check-cta-map.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkLiteralCtaValidity,
  checkComponentDuplicates,
  findDistModeViolations,
  findRequiredIdCoverage,
  extractCtaOccurrences,
  isChromeCta,
  cmpCodepoint,
  compareDigestKeys,
} from '../scripts/lib/cta-map-rules.mjs';

describe('source mode -- literal validity', () => {
  it('passes a valid literal data-cta', () => {
    assert.equal(checkLiteralCtaValidity('f.astro', `<a data-cta="donate.hero.donate">Give</a>`).length, 0);
  });
  it('flags an invalid literal data-cta', () => {
    const v = checkLiteralCtaValidity('f.astro', `<a data-cta="checkout.tiers.donate">Give</a>`);
    assert.equal(v.length, 1);
    assert.match(v[0].reason, /page token "checkout"/);
  });
  it('ignores an Astro-expression data-cta (cannot be judged from source text)', () => {
    assert.equal(checkLiteralCtaValidity('f.astro', `<a data-cta={ctaId}>Give</a>`).length, 0);
  });
  it('never fails on a money-shaped element with NO data-cta at all', () => {
    assert.equal(checkLiteralCtaValidity('f.astro', `<a href="/donate/">Give</a>`).length, 0);
  });
});

describe('source mode -- in-file duplicate literals', () => {
  it('flags the same literal data-cta twice in one file', () => {
    const source = `<a data-cta="donate.hero.donate">A</a><a data-cta="donate.hero.donate">B</a>`;
    const v = checkComponentDuplicates('f.astro', source);
    assert.equal(v.length, 1);
    assert.match(v[0].reason, /more than once/);
  });
  it('does not flag two different literals', () => {
    const source = `<a data-cta="donate.hero.donate">A</a><a data-cta="donate.tiers.join-stuc-member">B</a>`;
    assert.equal(checkComponentDuplicates('f.astro', source).length, 0);
  });
  it('does not flag the one id known to be shared across mutually exclusive Astro branches in courses/[slug].astro', () => {
    const source = `{isMembers ? <button data-cta="course.hero.course-enroll">Start Learning</button> : <button data-cta="course.hero.course-enroll">Enroll Now</button>}`;
    assert.equal(checkComponentDuplicates('src/pages/courses/[slug].astro', source).length, 0);
  });
  it('the same shared id in a DIFFERENT file is still flagged (the exemption is file-scoped, not id-scoped)', () => {
    const source = `<a data-cta="course.hero.course-enroll">A</a><a data-cta="course.hero.course-enroll">B</a>`;
    assert.equal(checkComponentDuplicates('src/pages/other.astro', source).length, 1);
  });
});

describe('dist mode -- rule 2 (rendered href/action/rel target)', () => {
  it('flags an untagged donate link', () => {
    const html = `<a href="/donate/">Give now</a>`;
    const v = findDistModeViolations('/donate/', html, new Set());
    assert.equal(v.length, 1);
    assert.match(v[0].reason, /has no data-cta attribute/);
  });
  it('passes a tagged donate link', () => {
    const html = `<a href="/donate/" data-cta="home.inline.donate">Give now</a>`;
    assert.equal(findDistModeViolations('/', html, new Set()).length, 0);
  });
  it('flags an untagged data-tier button with no href at all', () => {
    const html = `<button class="tier-btn" data-tier="member">Become a Member</button>`;
    assert.equal(findDistModeViolations('/donate/', html, new Set()).length, 1);
  });
  it('flags an untagged rel=sponsored affiliate link', () => {
    const html = `<a href="https://neofertility.example/enroll" rel="noopener sponsored">Enroll at NeoFertility</a>`;
    const v = findDistModeViolations('/courses/x/', html, new Set());
    assert.equal(v.length, 1);
  });
  it('/ and javascript: targets are out of scope', () => {
    const html = `<a href="/">Home</a><a href="javascript:location.reload()">Retry</a>`;
    assert.equal(findDistModeViolations('/', html, new Set()).length, 0);
  });
  it('an inline script building a login link via innerHTML string concatenation is not mistaken for a real rendered element', () => {
    const html = `
      <button id="mark-complete-btn">Mark Complete</button>
      <script>
        var markBtn = document.getElementById('mark-complete-btn');
        if (markBtn) {
          markBtn.outerHTML =
            '<a class="btn btn--secondary" href="/login/?redirect=' +
            encodeURIComponent(window.location.pathname) +
            '">Log in to track progress</a>';
        }
      </script>
    `;
    assert.equal(findDistModeViolations('/courses/x/lesson-1/', html, new Set()).length, 0, 'a JS string literal that looks like a tag must not be scanned as real markup');
  });
  it('a real navigational href with no money-path match is left alone even next to a checkout literal elsewhere on the page', () => {
    const html = `
      <a href="/courses/x/step-2/" id="continue-btn">Continue Learning</a>
      <script>
        document.getElementById('continue-btn');
        document.querySelectorAll('.enroll-btn').forEach(function () {});
        fetch('/api/courses/enroll', { method: 'POST' });
      </script>
    `;
    assert.equal(findDistModeViolations('/courses/x/', html, new Set()).length, 0, 'a real href already cleared by rule 2 must not also be flagged by rule 2b');
  });
});

describe('dist mode -- content-body exemption (data-cta-content, spec 4.3)', () => {
  it('an untagged donate link inside a data-cta-content body is not flagged', () => {
    const html = `<div class="prose" data-cta-content><p>Support us via <a href="/save-the-uterus-club/">Save the Uterus Club</a>.</p></div>`;
    assert.equal(findDistModeViolations('/commentary/x/', html, new Set()).length, 0);
  });
  it('the same untagged link outside a data-cta-content body is still flagged', () => {
    const html = `<p>Support us via <a href="/save-the-uterus-club/">Save the Uterus Club</a>.</p>`;
    assert.equal(findDistModeViolations('/commentary/x/', html, new Set()).length, 1);
  });
  it('a nested-div body still exempts a link after an inner closing div', () => {
    const html = `<div class="prose" data-cta-content><div class="inner"><p>Text</p></div><p>Then a <a href="/donate/">donate</a> link.</p></div>`;
    assert.equal(findDistModeViolations('/commentary/x/', html, new Set()).length, 0);
  });
});

describe('dist mode -- rule 2b (element-scoped, id/data-attr/class forms)', () => {
  it('flags an untagged #donate-btn wired by id in the same script', () => {
    const html = `
      <button id="donate-btn">Give $25</button>
      <script>
        document.getElementById('donate-btn').addEventListener('click', function () {
          fetch('/api/create-checkout', { method: 'POST' });
        });
      </script>
    `;
    const v = findDistModeViolations('/donate/', html, new Set());
    assert.equal(v.length, 1);
    assert.match(v[0].reason, /donate-btn/);
  });
  it('passes a tagged #donate-btn', () => {
    const html = `
      <button id="donate-btn" data-cta="donate.hero.donate">Give $25</button>
      <script>
        document.getElementById('donate-btn').addEventListener('click', function () {
          fetch('/api/create-checkout', { method: 'POST' });
        });
      </script>
    `;
    assert.equal(findDistModeViolations('/donate/', html, new Set()).length, 0);
  });
  it('flags an untagged class-wired enroll button', () => {
    const html = `
      <button class="enroll-btn" data-course-id="c1">Start Learning</button>
      <script>
        document.querySelectorAll('.enroll-btn').forEach(function (btn) {
          btn.addEventListener('click', function () { fetch('/api/courses/enroll', { method: 'POST' }); });
        });
      </script>
    `;
    assert.equal(findDistModeViolations('/courses/x/', html, new Set()).length, 1);
  });
  it('flags an untagged data-attribute-wired button', () => {
    const html = `
      <button data-newsletter-btn>Subscribe</button>
      <script>
        document.querySelectorAll('[data-newsletter-btn]');
        fetch('/api/newsletter/subscribe', { method: 'POST' });
      </script>
    `;
    assert.equal(findDistModeViolations('/', html, new Set()).length, 1);
  });
  it('does NOT flag across two separate script elements (never joined)', () => {
    const html = `
      <button id="unrelated-btn">Click</button>
      <script>document.getElementById('unrelated-btn');</script>
      <script>fetch('/api/create-checkout', { method: 'POST' });</script>
    `;
    assert.equal(findDistModeViolations('/x/', html, new Set()).length, 0, 'a literal in one script element must not wire an id referenced only in a different script element');
  });
  it('a submit button inside a tagged form is not flagged even when it carries its OWN data-attribute queried in the same script (newsletter-button shape)', () => {
    const html = `
      <form class="newsletter-form" data-newsletter-form data-cta="footer.inline.newsletter">
        <button type="submit" class="newsletter-btn" data-newsletter-btn>Subscribe</button>
      </form>
      <script>
        var form = document.querySelector('[data-newsletter-form]');
        var btn = form.querySelector('[data-newsletter-btn]');
        fetch('/api/newsletter/subscribe', { method: 'POST' });
      </script>
    `;
    assert.equal(findDistModeViolations('/', html, new Set()).length, 0);
  });
  it('an unrelated button far away in a large multi-purpose script is not flagged just because the script also contains a money literal elsewhere (account-page shape)', () => {
    const filler = 'x'.repeat(2000);
    const html = `
      <button id="logout-btn">Log out</button>
      <button id="manage-billing-btn">Manage Billing</button>
      <script>
        document.getElementById('logout-btn').addEventListener('click', function () {
          fetch('/api/auth/logout', { method: 'POST' });
        });
        ${filler}
        document.getElementById('manage-billing-btn').addEventListener('click', function () {
          fetch('/api/billing/portal', { method: 'POST' });
        });
      </script>
    `;
    const v = findDistModeViolations('/account/', html, new Set());
    assert.deepEqual(v.map((x) => x.label).sort(), ['#manage-billing-btn']);
  });
  it('flags an id assigned to a variable early but whose OWN click handler (far away) fetches the money endpoint (fund-give-btn shape)', () => {
    const filler = 'x'.repeat(2000);
    const html = `
      <button id="fund-give-btn">Give $50</button>
      <script>
        var giveBtn = document.getElementById('fund-give-btn');
        ${filler}
        giveBtn.addEventListener('click', function () {
          fetch('/api/create-checkout', { method: 'POST' });
        });
      </script>
    `;
    const v = findDistModeViolations('/providers/', html, new Set());
    assert.deepEqual(v.map((x) => x.label), ['#fund-give-btn']);
  });
  it('a submit button inside a tagged form is not separately flagged when it has no id/data-attr/class of its own', () => {
    const html = `
      <form id="email-form" data-cta="endo-survey.card.survey-start">
        <button type="submit">Get my private link</button>
      </form>
      <script>
        document.getElementById('email-form').addEventListener('submit', function () {
          fetch('/api/survey/request', { method: 'POST' });
        });
      </script>
    `;
    assert.equal(findDistModeViolations('/endo-survey/', html, new Set()).length, 0);
  });
});

describe('dist mode -- rule 3 (per-page duplicates) via extractCtaOccurrences + isChromeCta', () => {
  it('extracts tag, id, and trimmed label text', () => {
    const html = `<button data-cta="donate.hero.donate">  Give   $25  </button>`;
    const occ = extractCtaOccurrences(html);
    assert.equal(occ.length, 1);
    assert.equal(occ[0].ctaId, 'donate.hero.donate');
    assert.equal(occ[0].label, 'Give $25');
  });
  it('a chrome id is exempt from the per-page dedup check', () => {
    assert.equal(isChromeCta('footer.footer-col-4.donate'), true);
    assert.equal(isChromeCta('header.sticky.donate'), true);
    assert.equal(isChromeCta('nav-mobile.sidebar.account'), true);
    assert.equal(isChromeCta('donate.hero.donate'), false);
  });
});

describe('cta-required-ids.json coverage (element-level starting condition)', () => {
  it('a required id absent from a rendered page yields no data-cta occurrence for it', () => {
    const html = `<a href="/donate/" data-cta="home.inline.donate">Give</a>`;
    const occ = extractCtaOccurrences(html);
    assert.equal(occ.some((o) => o.ctaId === 'donate.hero.donate'), false);
  });
});

describe('findRequiredIdCoverage (m3: exercises the actual coverage check)', () => {
  it('a listed id absent from every page fails', () => {
    const pages = [`<a href="/donate/" data-cta="donate.hero.donate">Give</a>`];
    const failures = findRequiredIdCoverage(pages, new Set(['donate-btn']));
    assert.equal(failures.length, 1);
    assert.match(failures[0], /"donate-btn"/);
  });
  it('a listed id present but without data-cta fails', () => {
    const pages = [`<button id="donate-btn">Give</button>`];
    const failures = findRequiredIdCoverage(pages, new Set(['donate-btn']));
    assert.equal(failures.length, 1);
  });
  it('a listed id present and tagged with a valid data-cta passes', () => {
    const pages = [`<button id="donate-btn" data-cta="donate.hero.donate">Give</button>`];
    assert.equal(findRequiredIdCoverage(pages, new Set(['donate-btn'])).length, 0);
  });
  it('coverage spans multiple pages -- the id can be tagged on any one of them', () => {
    const pages = [
      `<a href="/donate/">Give</a>`,
      `<button id="manage-billing-btn" data-cta="stuc.card.manage-billing">Manage Billing</button>`,
    ];
    assert.equal(findRequiredIdCoverage(pages, new Set(['manage-billing-btn'])).length, 0);
  });
});

describe('cmpCodepoint (determinism)', () => {
  it('is a strict three-way codepoint comparator', () => {
    assert.equal(cmpCodepoint('a', 'b'), -1);
    assert.equal(cmpCodepoint('b', 'a'), 1);
    assert.equal(cmpCodepoint('a', 'a'), 0);
  });
  it('sorts a mixed-script path list the same way on repeated runs, by codepoint not locale collation', () => {
    const paths = ['/library/z/', '/library/œstrogen/', '/library/a/'];
    const sortOnce = () => [...paths].sort(cmpCodepoint);
    const first = sortOnce();
    const second = sortOnce();
    assert.deepEqual(first, second);
    // Codepoint order: 'a' (0x61) < 'z' (0x7a) < 'œ' (0x153, œ) --
    // a locale-aware collation (localeCompare, or a bare .sort() under an
    // ICU build that treats œ as a ligature for "oe") could easily place
    // "œstrogen" before "z", which is exactly the nondeterminism this
    // comparator exists to rule out.
    assert.deepEqual(first, ['/library/a/', '/library/z/', '/library/œstrogen/']);
  });
});

describe('dist mode -- rule 2b handler tracing, additional shapes (finding #2)', () => {
  it('querySelector("#id") direct-chain wiring is recognized', () => {
    const html = `
      <button id="give-btn">Give</button>
      <script>
        document.querySelector('#give-btn').addEventListener('click', function () {
          fetch('/api/create-checkout', { method: 'POST' });
        });
      </script>
    `;
    const v = findDistModeViolations('/donate/', html, new Set());
    assert.equal(v.length, 1);
    assert.match(v[0].label, /give-btn/);
  });
  it('querySelector("#id") assigned to a variable, wired far away, is recognized', () => {
    const filler = 'x'.repeat(1000);
    const html = `
      <button id="give-btn-2">Give</button>
      <script>
        var giveBtn = document.querySelector('#give-btn-2');
        ${filler}
        giveBtn.addEventListener('click', function () {
          fetch('/api/create-checkout', { method: 'POST' });
        });
      </script>
    `;
    assert.equal(findDistModeViolations('/donate/', html, new Set()).length, 1);
  });
  it('.onclick = assignment handler is recognized', () => {
    const html = `
      <button id="give-btn-3">Give</button>
      <script>
        document.getElementById('give-btn-3').onclick = function () {
          fetch('/api/create-checkout', { method: 'POST' });
        };
      </script>
    `;
    assert.equal(findDistModeViolations('/donate/', html, new Set()).length, 1);
  });
  it('.onsubmit = assignment handler is recognized', () => {
    const html = `
      <form id="pledge-form">
        <button type="submit">Give</button>
      </form>
      <script>
        document.getElementById('pledge-form').onsubmit = function () {
          fetch('/api/create-checkout', { method: 'POST' });
          return false;
        };
      </script>
    `;
    const v = findDistModeViolations('/donate/', html, new Set());
    assert.equal(v.length, 1);
    assert.match(v[0].label, /pledge-form/);
  });
  it('a compound class selector (.enroll-btn.primary) is recognized', () => {
    const html = `
      <button class="enroll-btn primary" data-course-id="c1">Start</button>
      <script>
        document.querySelectorAll('.enroll-btn.primary').forEach(function (btn) {
          btn.addEventListener('click', function () { fetch('/api/courses/enroll', { method: 'POST' }); });
        });
      </script>
    `;
    assert.equal(findDistModeViolations('/courses/x/', html, new Set()).length, 1);
  });
  it('exempt submit-in-tagged-form case still passes with the new tracing (regression)', () => {
    const html = `
      <form id="email-form" data-cta="endo-survey.card.survey-start">
        <button type="submit" data-survey-btn>Get my private link</button>
      </form>
      <script>
        var btn = document.querySelector('[data-survey-btn]');
        document.getElementById('email-form').addEventListener('submit', function () {
          btn.disabled = true;
          fetch('/api/survey/request', { method: 'POST' });
        });
      </script>
    `;
    assert.equal(findDistModeViolations('/endo-survey/', html, new Set()).length, 0);
  });
  it('a submit button in a tagged form that has its OWN independent money-wired handler is NOT exempt', () => {
    const html = `
      <form id="email-form" data-cta="endo-survey.card.survey-start">
        <button type="submit" id="also-donate-btn">Get my private link and donate</button>
      </form>
      <script>
        document.getElementById('email-form').addEventListener('submit', function () {
          fetch('/api/survey/request', { method: 'POST' });
        });
        document.getElementById('also-donate-btn').addEventListener('click', function () {
          fetch('/api/create-checkout', { method: 'POST' });
        });
      </script>
    `;
    const v = findDistModeViolations('/endo-survey/', html, new Set());
    assert.equal(v.length, 1);
    assert.match(v[0].label, /also-donate-btn/);
  });
});

describe('compareDigestKeys (C1: coverage floor, not byte equality)', () => {
  const baseRow = { pageFamily: 'donate', ctaId: 'donate.hero.donate', elementType: 'a', label: 'Give' };
  const otherRow = { pageFamily: 'account', ctaId: 'account.card.manage-billing', elementType: 'button', label: 'Manage Billing' };

  it('an identical fresh digest has no missing and no extra keys', () => {
    const { missing, extra } = compareDigestKeys([baseRow], [baseRow]);
    assert.deepEqual(missing, []);
    assert.deepEqual(extra, []);
  });

  it('a fresh digest with one extra row (e.g. a closed-cohort modal that only renders sometimes) passes with a warning, not a failure', () => {
    const { missing, extra } = compareDigestKeys([baseRow], [baseRow, otherRow]);
    assert.deepEqual(missing, [], 'an extra key must never fail the coverage floor');
    assert.deepEqual(extra, ['account account.card.manage-billing']);
  });

  it('a fresh digest missing a committed row fails, naming it', () => {
    const { missing, extra } = compareDigestKeys([baseRow, otherRow], [baseRow]);
    assert.deepEqual(missing, ['account account.card.manage-billing']);
    assert.deepEqual(extra, []);
  });

  it('a label/elementType change on an existing key is neither missing nor extra -- label text is copy, not coverage', () => {
    const relabeled = { ...baseRow, label: 'Give Now', elementType: 'button' };
    const { missing, extra } = compareDigestKeys([baseRow], [relabeled]);
    assert.deepEqual(missing, []);
    assert.deepEqual(extra, []);
  });

  it('an empty committed digest (first run) reports every fresh row as extra, never missing', () => {
    const { missing, extra } = compareDigestKeys([], [baseRow, otherRow]);
    assert.deepEqual(missing, []);
    assert.equal(extra.length, 2);
  });
});

describe('committed docs/cta-map.json shape (C1: no pageCount)', () => {
  it('carries no pageCount field on any row', () => {
    const rows = JSON.parse(readFileSync(new URL('../docs/cta-map.json', import.meta.url), 'utf8'));
    assert.ok(rows.length > 0, 'the committed digest must not be empty');
    for (const row of rows) {
      assert.equal(Object.hasOwn(row, 'pageCount'), false, `row ${row.pageFamily} ${row.ctaId} must not carry pageCount`);
    }
  });
});

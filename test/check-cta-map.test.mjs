/**
 * Fixture tests for scripts/lib/cta-map-rules.mjs -- both source-mode's two
 * cheap checks and dist-mode's three enforcing rules, plus the
 * cta-required-ids.json coverage check.
 *
 * Run with: node --experimental-strip-types --test test/check-cta-map.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLiteralCtaValidity,
  checkComponentDuplicates,
  findDistModeViolations,
  extractCtaOccurrences,
  isChromeCta,
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

/**
 * Fixtures for the PUBLIC event landing page (functions/events/[slug].js).
 *
 * WHY A REAL DATABASE AND A REAL SESSION
 * --------------------------------------
 * /events/<slug> is not auth-gated, but it renders four DIFFERENT pages
 * depending on who is asking, and the thing that decides which one you get is
 * requireMember() in functions/api/community/_shared.js -- the canonical STUC
 * membership gate. Stubbing that gate would hand back 100% coverage of a gate
 * nobody tested: every "members see the Meet link, non-members do not"
 * assertion would be asserting the stub. So every tier here is reached the way
 * a browser reaches it, through a session cookie whose SHA-256 is a real row in
 * a real `session` table, against the committed rrm-auth schema.
 *
 * SCHEMA PROVENANCE
 * -----------------
 * test/_d1-sqlite.mjs builds the database from schema.sql, a 2026-05-27
 * snapshot of live rrm-auth. migrations/025-stuc-action-areas.sql landed after
 * that snapshot and adds community_post.area_id. The event page's SELECT does
 * not name area_id, so nothing here depends on it -- but the fixture replays
 * the committed DDL OFF DISK anyway (never a hand-written ALTER), so the table
 * this suite inserts into has production's column set rather than a shape this
 * file invented. If 025 is ever amended, the fixture moves with it.
 *
 * WHAT THIS FIXTURE CANNOT PROVE
 * ------------------------------
 * The inherited caveats of _d1-sqlite.mjs apply unchanged (snapshot drift, D1
 * engine differences, no real concurrency). Beyond those: Stripe is never
 * reached. Every membership path used here resolves BEFORE the live-Stripe
 * check -- staff by role, member by the explicit grandfather allowlist -- so a
 * regression in requireMember's Stripe arm is out of scope for this file and is
 * held by test/collation-identity.test.js instead.
 */
import { readFileSync } from 'node:fs';
import { sqliteD1, insertUser, insertSession, insertLabel } from './_d1-sqlite.mjs';
import { mockRequest } from './_helpers.js';

const page = await import('../functions/events/[slug].js');

/** Committed DDL, read off disk. Never transcribed. */
const MIGRATION_025 = readFileSync(
  new URL('../migrations/025-stuc-action-areas.sql', import.meta.url), 'utf8'
);

export const SESSION_RAW = 'raw-event-session-token';
export const SESSION_COOKIE = `session=${SESSION_RAW}`;
const FAR_FUTURE = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

/** Far enough ahead that ctaForVisitor's isPast arm cannot fire. */
export const FUTURE_DATE = '2099-03-01T18:00:00.000Z';
/** Far enough behind that it cannot race the one-hour grace window. */
export const PAST_DATE = '2020-03-01T18:00:00.000Z';

const POST_DEFAULTS = {
  id: 'post_evt_1',
  author_id: 'usr_staff',
  type: 'event',
  title: 'Endometriosis Excision, Start to Finish',
  channel: 'stuc',
  content: null,
  slug: 'endo-excision-call',
  event_date: FUTURE_DATE,
  event_link: 'https://meet.google.com/gat-eded-xyz',
  og_image_url: null,
  speaker: null,
  body: null,
};

/**
 * Builds the database the page reads from.
 *
 * @param {object} [opts]
 * @param {object|null} [opts.post] - community_post column overrides; null seeds no row.
 * @param {'anonymous'|'authenticated'|'member'|'staff'} [opts.viewer] - who the
 *   session cookie belongs to. 'anonymous' seeds no session at all.
 * @param {(sqlite) => void} [opts.seed] - extra seeding, after the defaults.
 * @param {(call) => void} [opts.interleave] - forwarded to sqliteD1.
 */
export async function eventDb({ post = {}, viewer = 'anonymous', seed, interleave } = {}) {
  let handle;
  const db = sqliteD1({
    interleave,
    seed(s) {
      handle = s;
      s.exec(MIGRATION_025);

      // The event's author. Always staff, because only staff can author events.
      insertUser(s, { id: 'usr_staff', email: 'staff@rrmacademy.org', role: 'admin', email_verified: 1 });
      // The visitor, when there is one. Distinct row from the author so a
      // "member sees the link" pass can never be the author's own row.
      insertUser(s, {
        id: 'usr_visitor',
        email: 'visitor@example.com',
        email_verified: 1,
        role: viewer === 'staff' ? 'admin' : 'member',
      });
      if (viewer === 'member') {
        // The explicit legacy allowlist in requireMember. Resolves to tier
        // 'member' without touching Stripe or KV.
        insertLabel(s, 'usr_visitor', 'STUC Legacy Grandfather');
      }

      if (post) {
        const row = { ...POST_DEFAULTS, ...post };
        const cols = Object.keys(row);
        s.prepare(
          `INSERT INTO community_post (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
        ).run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
      }
      if (seed) seed(s);
    },
  });

  if (viewer !== 'anonymous') {
    await insertSession(handle, { rawId: SESSION_RAW, userId: 'usr_visitor', expiresAt: FAR_FUTURE });
  }
  return db;
}

/**
 * Drives the real handler. STRIPE_SECRET_KEY is set because requireMember
 * returns a 500 without it, which would collapse the authenticated-non-member
 * tier into a misleading pass; no path exercised here actually calls Stripe.
 */
export async function getEvent(db, opts = {}) {
  const { viewer = 'anonymous', query = '', env = {} } = opts;
  // `in` rather than a default value: a test that deliberately passes
  // `slug: undefined` is testing the missing-slug guard, and a default would
  // silently hand it the valid slug instead and pass for the wrong reason.
  const slug = 'slug' in opts ? opts.slug : 'endo-excision-call';
  const url = `https://rrmacademy.org/events/${encodeURIComponent(String(slug))}/${query}`;
  const response = await page.onRequestGet({
    request: mockRequest('GET', {
      url,
      headers: viewer === 'anonymous' ? {} : { Cookie: SESSION_COOKIE },
    }),
    params: { slug },
    env: { DB: db, STRIPE_SECRET_KEY: 'sk_test_never_called', COMMUNITY_KV: null, ...env },
  });
  return response;
}

/**
 * Handler + parsed sinks in one call, for the common case. The database is
 * closed before returning; a test that needs to inspect rows afterwards should
 * drive eventDb() + getEvent() itself.
 */
export async function renderEvent(opts = {}) {
  const db = await eventDb(opts);
  try {
    const response = await getEvent(db, opts);
    const html = await response.text();
    return { response, html, ...sinks(html) };
  } finally {
    db.close();
  }
}

/**
 * Splits the rendered page into the three sinks the redaction requirement
 * names, INDEPENDENTLY. They are pulled apart deliberately: the body could be
 * scrubbed while og:description or the JSON-LD is built from unscrubbed source,
 * and asserting on the whole document would let exactly that leak pass.
 */
export function sinks(html) {
  const attr = (re) => re.exec(html)?.[1] ?? null;
  const jsonLdRaw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? null;
  let jsonLd = null;
  let jsonLdParseError = null;
  if (jsonLdRaw !== null) {
    try { jsonLd = JSON.parse(jsonLdRaw); } catch (err) { jsonLdParseError = err.message; }
  }
  return {
    /** Rendered visitor-facing prose only. null when the page rendered no body. */
    body: /<div class="body">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? null,
    ogDescription: attr(/<meta property="og:description" content="([^"]*)">/),
    ogTitle: attr(/<meta property="og:title" content="([^"]*)">/),
    ogImage: attr(/<meta property="og:image" content="([^"]*)">/),
    twitterDescription: attr(/<meta name="twitter:description" content="([^"]*)">/),
    metaDescription: attr(/<meta name="description" content="([^"]*)">/),
    canonical: attr(/<link rel="canonical" href="([^"]*)">/),
    docTitle: attr(/<title>([^<]*)<\/title>/),
    h1: attr(/<h1>([\s\S]*?)<\/h1>/),
    jsonLdRaw,
    jsonLd,
    jsonLdParseError,
    ctaPrimary: attr(/<a class="btn btn--primary" href="([^"]*)"/),
    ctaPrimaryLabel: attr(/<a class="btn btn--primary"[^>]*>([\s\S]*?)<\/a>/),
    ctaSecondary: attr(/<a class="btn btn--secondary" href="([^"]*)"/),
    ctaSecondaryLabel: attr(/<a class="btn btn--secondary"[^>]*>([\s\S]*?)<\/a>/),
    ctaNote: attr(/<p class="cta__note">([\s\S]*?)<\/p>/),
    gcalHref: attr(/<a class="cta__cal-link" href="([^"]*)" target="_blank"/),
    icsHref: attr(/<a class="cta__cal-link" href="([^"]*)">Apple \/ Outlook<\/a>/),
    flyerSrc: attr(/<img class="flyer" src="([^"]*)"/),
    speakerRow: attr(/<span class="meta__row">Speaker: ([^<]*)<\/span>/),
    dateRow: attr(/<span class="meta__row"><strong>([^<]*)<\/strong><\/span>/),
  };
}

/**
 * The three sinks the file comment says joining info must never reach, as a
 * list, so a test can loop them and name the one that failed rather than
 * asserting on a concatenation that hides which sink leaked.
 *
 * The rendered body is included because for a NON-member it is the fourth
 * place the same scrubbed summary lands.
 */
export function redactionSinks(s) {
  return [
    ['rendered body', s.body ?? ''],
    ['og:description', s.ogDescription ?? ''],
    ['twitter:description', s.twitterDescription ?? ''],
    ['meta description', s.metaDescription ?? ''],
    ['schema.org JSON-LD', s.jsonLdRaw ?? ''],
  ];
}

/** HTML-attribute escaping the page applies, so a needle can be looked for in either form. */
export function appearsIn(haystack, needle) {
  const escaped = needle
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return haystack.includes(needle) || haystack.includes(escaped);
}

/**
 * functions/events/[slug].js -- the PUBLIC /events/<slug> landing page, and the
 * regex-allowlist redaction (scrubJoinInfo) that is the only thing standing
 * between a members-only Google Meet room and the open web.
 *
 * Neither this file nor functions/events/_tracking.js had ever been imported by
 * a test before this suite existed. c8 --all reported both at 0% by name.
 *
 * WHY THE REDACTION IS THE POINT
 * ------------------------------
 * The page's own header states the requirement: joining info "MUST NOT appear
 * in body, og:description, or JSON-LD". It is enforced by ELEVEN regexes over
 * free text a human typed into an admin form. Regex-allowlist redaction is
 * silent on any format its author did not anticipate: nothing throws, nothing
 * logs, the page renders 200, and the credential is simply there. So this suite
 * does two separate jobs, and keeps them separate on purpose:
 *
 *   1. PROVE each pattern redacts what it claims (describe block A). Each case
 *      is shaped so ONLY the pattern under test can match it, so deleting that
 *      one regex turns exactly one test red.
 *   2. HUNT for formats the patterns miss (describe block B), and report what
 *      is found HONESTLY. The leak assertions below assert that the credential
 *      IS present, because that is what the deployed code does today. They are
 *      findings written as executable evidence, not endorsements. Each one says
 *      in its failure message what to do when it goes green.
 *
 * WHY EACH SINK IS ASSERTED SEPARATELY
 * ------------------------------------
 * The rendered body, og:description, twitter:description, the plain meta
 * description and the schema.org JSON-LD are five different strings built at
 * five different points in renderHtml(). The member branch (isMember ? ... )
 * deliberately makes the BODY diverge from the rest. A test that searched the
 * whole document would pass while og:description leaked, which is precisely how
 * this class of bug survives review. Nothing here asserts on a concatenation.
 *
 * WHY THE MEMBERSHIP GATE IS REAL
 * -------------------------------
 * Every tier is reached through a session cookie whose SHA-256 is a row in a
 * real `session` table, resolved by the canonical requireMember(). Stubbing it
 * would produce 100% coverage of a gate nobody tested. See _event-page-fixtures.mjs.
 *
 * COVERAGE, AND THE FOUR BRANCHES THAT ARE NOT REACHABLE FROM onRequestGet
 * ------------------------------------------------------------------------
 * Both files reach 100% lines / 100% statements / 100% functions. Four DEFENSIVE
 * branches remain uncovered, and each is unreachable through the module's only
 * entry point rather than merely untested. The claim is not an argument: each
 * fallback was replaced by `throw` and this whole file re-run; all tests still
 * passed, so none of the four fires. The static reason in each case:
 *
 *   [slug].js:20   escapeHtml's `s == null` guard. All 22 call sites pass either
 *                  a locally-computed string (title/description/canonical/ogImage,
 *                  each with its own `||` fallback) or a value already guarded by
 *                  a truthiness test in the same expression (speaker, cta.note,
 *                  cta.secondaryLabel, the flyer src, gcalUrl).
 *   [slug].js:220-223  buildGoogleCalUrl's `title || ...`, `details || ''`,
 *                  `location || ''`. Its single call site (line 265) passes
 *                  `title` (already defaulted), `calDescription` (a template
 *                  literal with a constant prefix) and `eventsUrl` (a template
 *                  literal on SITE_ORIGIN) -- none can be falsy.
 *   [slug].js:227  icsEscape's `s == null` ternary. Its six call sites are all
 *                  inside buildICS, whose single call site (line 578) supplies
 *                  seven non-null values, `title` via its own `||` fallback.
 *   [slug].js:307  `.chunks || []` and the `memberSummary` falsy arm. summarize()
 *                  returns `chunks` on both of its return paths, and renderHtml's
 *                  single call site (line 599) always passes memberSummary.
 *
 * They are left in place: they are cheap, and the first three would become live
 * the moment renderHtml or buildICS gained a second call site.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventDb, getEvent, renderEvent, sinks, redactionSinks, appearsIn,
  FUTURE_DATE, PAST_DATE, SESSION_COOKIE,
} from './_event-page-fixtures.mjs';
import { TRACKING_HEAD, TRACKING_BODY } from '../functions/events/_tracking.js';
import { readFileSync } from 'node:fs';

/**
 * Wraps a candidate credential line as its own paragraph, with prose on both
 * sides. The prose either side is load-bearing: it proves the scrubber removed
 * the credential rather than the page rendering nothing at all, which would
 * make a "not present" assertion vacuous.
 */
function contentAround(line) {
  return `Opening paragraph, kept.\n\n${line}\n\nClosing paragraph, kept.`;
}

/** Every sink, named, with the ones that still contain `needle`. */
function leakingSinks(s, needle) {
  return redactionSinks(s).filter(([, value]) => appearsIn(value, needle)).map(([name]) => name);
}

// =====================================================================
// A. The eleven patterns: prove each redacts what it claims
// =====================================================================

/**
 * JOIN_INFO_PATTERNS has nine entries; scrubJoinInfo then runs two further
 * inline .replace() calls for "leftover bare meet URLs" -- eleven redactions in
 * total. Each case below is written so no OTHER pattern can claim it:
 *   - the label cases use a host that is not meet.google.com / tel.meet, so
 *     patterns 7, 8, 10 and 11 cannot fire;
 *   - the host cases carry no scheme, so patterns 10 and 11 cannot fire;
 *   - no label case reuses another label's keyword.
 * Deleting any single regex from the source therefore reddens exactly one test.
 */
const PATTERN_CASES = [
  { n: 1, name: 'Meet link:', line: 'Meet link: https://video.example/room-p1a', needle: 'room-p1a' },
  { n: 1, name: 'Google Meet link:', line: 'Google Meet link: https://video.example/room-p1b', needle: 'room-p1b' },
  { n: 2, name: 'Join via Google Meet:', line: 'Join via Google Meet: https://video.example/room-p2', needle: 'room-p2' },
  { n: 2, name: 'Join Google Meet:', line: 'Join Google Meet: https://video.example/room-p2b', needle: 'room-p2b' },
  { n: 3, name: 'Join the call:', line: 'Join the call: https://video.example/room-p3', needle: 'room-p3' },
  { n: 3, name: 'Join call:', line: 'Join call: https://video.example/room-p3b', needle: 'room-p3b' },
  { n: 4, name: 'Dial-in:', line: 'Dial-in: +1 555-010-1111', needle: '555-010-1111' },
  { n: 4, name: 'Dial:', line: 'Dial: +1 555-010-2222', needle: '555-010-2222' },
  { n: 4, name: 'Dialin:', line: 'Dialin: +1 555-010-3333', needle: '555-010-3333' },
  { n: 5, name: 'Phone:', line: 'Phone: +1 555-010-4444', needle: '555-010-4444' },
  { n: 6, name: 'PIN:', line: 'PIN: 998877665', needle: '998877665' },
  { n: 7, name: 'bare meet.google.com host', line: 'Reminder, the room is meet.google.com/aaa-bbbb-ccc all week.', needle: 'aaa-bbbb-ccc' },
  { n: 8, name: 'bare tel.meet host', line: 'Voice backup is tel.meet/ddd-eeee-fff for this call.', needle: 'ddd-eeee-fff' },
  { n: 9, name: 'tel: URI at line start', line: 'tel:+15550105555', needle: '15550105555' },
];

describe('scrubJoinInfo -- pattern by pattern, on a page a non-member is looking at', () => {
  for (const { n, name, line, needle } of PATTERN_CASES) {
    it(`pattern ${n} redacts "${name}" from every sink`, async () => {
      const rendered = await renderEvent({
        viewer: 'anonymous',
        post: { content: contentAround(line) },
      });

      assert.equal(rendered.response.status, 200);
      assert.deepEqual(
        leakingSinks(rendered, needle), [],
        `pattern ${n} ("${name}") did not redact ${JSON.stringify(needle)}; `
        + 'a member-only joining credential reached a public page'
      );
      // Not-present is only meaningful if the page rendered prose at all.
      assert.match(rendered.body ?? '', /Closing paragraph, kept\./,
        'the surrounding prose vanished too, so "credential absent" proves nothing here');
      assert.match(rendered.ogDescription ?? '', /Closing paragraph, kept\./);
    });
  }

  it('leaves ordinary prose alone (the scrubber is not just deleting the body)', async () => {
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\nWe will discuss surgical technique.\n\nBring questions.' },
    });
    assert.equal(rendered.body, '<p>We will discuss surgical technique.</p>\n<p>Bring questions.</p>');
    assert.equal(rendered.ogDescription, 'We will discuss surgical technique. Bring questions.');
  });

  it('collapses the blank space a removed line leaves behind', async () => {
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\nBefore.\n\nPIN: 445566\n\nAfter.' },
    });
    assert.equal(rendered.body, '<p>Before.</p>\n<p>After.</p>',
      'the removal left an empty paragraph, which is what the \\n{3,} collapse exists to prevent');
  });

  it('handles content that is nothing but an image (scrubJoinInfo receives an empty string)', async () => {
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { content: '![flyer](https://cdn.example/flyer.png)' },
    });
    assert.equal(rendered.response.status, 200);
    assert.equal(rendered.body, null, 'no prose survived, so no body element should be emitted');
    assert.equal(rendered.flyerSrc, 'https://cdn.example/flyer.png');
  });

  it('CRLF line endings do not defeat the ^/$ anchors', async () => {
    // The patterns anchor with /m. `.` does not match \r, and $ matches before
    // a \r as well as before a \n, so a Windows-authored line still terminates
    // where the pattern expects. Asserted rather than assumed.
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\nDetails follow.\r\nPIN: 24680\r\nDial-in: +1 555-010-6666\r\nSee you there.' },
    });
    assert.deepEqual(leakingSinks(rendered, '24680'), []);
    assert.deepEqual(leakingSinks(rendered, '555-010-6666'), []);
    assert.match(rendered.body ?? '', /See you there\./);
  });

  it('a mixed-case host is redacted (the /i flag is real, not assumed)', async () => {
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('Join at https://Meet.Google.COM/mIx-eDcA-sEt now.') },
    });
    assert.deepEqual(leakingSinks(rendered, 'mIx-eDcA-sEt'), []);
  });

  it('a Meet URL inside a markdown link is redacted', async () => {
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('Join [click here](https://meet.google.com/mkd-lnkk-abc) now.') },
    });
    assert.deepEqual(leakingSinks(rendered, 'mkd-lnkk-abc'), []);
    assert.deepEqual(leakingSinks(rendered, 'meet.google.com'), []);
  });

  it('a Meet URL with a query, a fragment, or wrapped in parentheses is redacted', async () => {
    for (const line of [
      'Use https://meet.google.com/qry-aaaa-bbb?authuser=0 today.',
      'Use https://meet.google.com/frg-aaaa-bbb#start today.',
      'Use (https://meet.google.com/par-aaaa-bbb) today.',
    ]) {
      const rendered = await renderEvent({ viewer: 'anonymous', post: { content: contentAround(line) } });
      const code = /\/([a-z]{3}-aaaa-bbb)/.exec(line)[1];
      assert.deepEqual(leakingSinks(rendered, code), [], `leaked from: ${line}`);
    }
  });

  it('patterns 10 and 11 are unreachable: 7 and 8 delete the whole line first', async () => {
    // scrubJoinInfo's two trailing .replace() calls say they "catch any leftover
    // bare meet URLs that weren't on their own line". They cannot: patterns 7
    // and 8 (`^.*meet\.google\.com.*$` / `^.*tel\.meet.*$`, /gim) already delete
    // EVERY line containing those hosts, so no leftover exists to catch. The
    // observable fingerprint is that the surrounding sentence disappears too --
    // if pattern 10 were doing the work, only the URL would be gone.
    const meet = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\nWe will use https://meet.google.com/qqq-wwww-eee for this session.' },
    });
    assert.equal(meet.body, null,
      'pattern 7 no longer removes the whole line; if only the URL is gone, pattern 10 is now live '
      + 'and this test should be rewritten rather than deleted');

    const tel = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\nCall https://tel.meet/rrr-tttt-yyy to join by voice.' },
    });
    assert.equal(tel.body, null, 'pattern 8 no longer removes the whole line');
  });
});

// =====================================================================
// B. The leak hunt -- findings, written as executable evidence
// =====================================================================

/**
 * Every case below reached a PUBLIC sink on a page an anonymous visitor sees.
 * They are grouped by the shape of the miss so the fix can be reasoned about as
 * classes rather than as a list of one-off regexes.
 *
 * These assertions are deliberately positive ("it leaked"). When the redaction
 * is fixed they go red, which is the point: the fixer is told, by name, which
 * finding they closed, and moves the case up into block A.
 */
const KNOWN_LEAKS = [
  // --- class 1: labels no pattern covers -------------------------------
  { id: 'EV-L1', why: 'label "Meeting link:" is not in the allowlist', line: 'Meeting link: https://video.example/leak-mtglink', needle: 'leak-mtglink' },
  { id: 'EV-L2', why: 'label "Video call:" is not in the allowlist', line: 'Video call: https://video.example/leak-videocall', needle: 'leak-videocall' },
  { id: 'EV-L3', why: 'label "Zoom:" is not in the allowlist', line: 'Zoom: https://zoom.example/j/leak-zoom', needle: 'leak-zoom' },
  { id: 'EV-L4', why: 'label "Teams:" is not in the allowlist', line: 'Teams: https://teams.example/l/leak-teams', needle: 'leak-teams' },
  { id: 'EV-L5', why: 'label "Join here:" is not in the allowlist', line: 'Join here: https://video.example/leak-joinhere', needle: 'leak-joinhere' },
  { id: 'EV-L6', why: 'label "Conference line:" is not in the allowlist', line: 'Conference line: +1 555-020-1111', needle: '555-020-1111' },
  { id: 'EV-L7', why: 'label "Room:" is not in the allowlist', line: 'Room: 555 020 2222', needle: '555 020 2222' },
  { id: 'EV-L8', why: 'PIN synonym "Passcode:" is not in the allowlist', line: 'Passcode: 987654', needle: '987654' },
  { id: 'EV-L9', why: 'PIN synonym "Access code:" is not in the allowlist', line: 'Access code: 987655', needle: '987655' },
  { id: 'EV-L10', why: 'PIN synonym "Meeting ID:" is not in the allowlist', line: 'Meeting ID: 987 6543 210', needle: '987 6543 210' },

  // --- class 2: the ^ anchor ------------------------------------------
  { id: 'EV-A1', why: 'an allowlisted label mid-line escapes the ^ anchor', line: 'Everything you need follows. PIN: 445566', needle: '445566' },
  { id: 'EV-A2', why: 'a tel: URI mid-sentence escapes the ^ anchor', line: 'You can dial tel:+15550207777 from any phone.', needle: '15550207777' },

  // --- class 3: an unlabelled number ------------------------------------
  { id: 'EV-N1', why: 'a bare dial-in number carries no label to match', line: 'Call 5550208888 to join by voice.', needle: '5550208888' },

  // --- class 4: the literal host string ---------------------------------
  { id: 'EV-H1', why: 'a Google Meet nickname link is on a different host (g.co)', line: 'Join at https://g.co/meet/rrm-weekly-call today.', needle: 'rrm-weekly-call' },
  { id: 'EV-H2', why: 'a zero-width space inside the host defeats the literal match', line: 'Join at https://meet.goo​gle.com/zwj-aaaa-bbb today.', needle: 'zwj-aaaa-bbb' },
];

describe('scrubJoinInfo -- the leak hunt (each of these is a production finding)', () => {
  for (const { id, why, line, needle } of KNOWN_LEAKS) {
    it(`LEAKS ${id}: ${why}`, async () => {
      const rendered = await renderEvent({
        viewer: 'anonymous',
        post: { content: contentAround(line) },
      });
      const leaked = leakingSinks(rendered, needle);
      assert.deepEqual(
        leaked,
        ['rendered body', 'og:description', 'twitter:description', 'meta description', 'schema.org JSON-LD'],
        `${id} no longer reaches every public sink. If ${JSON.stringify(needle)} is now redacted, `
        + 'the finding is FIXED: delete this case and add it to PATTERN_CASES in block A instead.'
      );
    });
  }

  it('LEAKS EV-W1: a Meet URL broken across a soft line wrap leaks its tail', async () => {
    // Pattern 7 deletes only the line the host appears on. The remainder of a
    // wrapped URL survives on the next line, which is the second half of a
    // meeting code.
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('Join https://meet.google.com/wrp-\naaaa-bbb before 6pm.') },
    });
    assert.deepEqual(leakingSinks(rendered, 'aaaa-bbb'),
      ['rendered body', 'og:description', 'twitter:description', 'meta description', 'schema.org JSON-LD'],
      'EV-W1 no longer leaks the wrapped tail; move this case into block A');
    assert.deepEqual(leakingSinks(rendered, 'wrp-'), [],
      'the leading fragment is on the deleted line and should still be gone');
  });

  it('LEAKS EV-T1: community_post.title is never scrubbed at all', async () => {
    // scrubJoinInfo only ever sees `content`. The title column is rendered
    // verbatim into <h1>, <title>, og:title and JSON-LD `name`, for every tier.
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { title: 'Weekly Call PIN: 313131', content: 'Title chunk.\n\nBody text.' },
    });
    assert.match(rendered.h1 ?? '', /PIN: 313131/, 'EV-T1 fixed in <h1>; move this case into block A');
    assert.match(rendered.ogTitle ?? '', /PIN: 313131/, 'EV-T1 fixed in og:title');
    assert.match(rendered.docTitle ?? '', /PIN: 313131/, 'EV-T1 fixed in <title>');
    assert.equal(rendered.jsonLd.name, 'Weekly Call PIN: 313131', 'EV-T1 fixed in JSON-LD name');
  });

  it('LEAKS EV-S1: the Speaker line is read from UNSCRUBBED content and re-emitted', async () => {
    // extractSpeaker() runs against event.content directly, not against the
    // scrubbed summary, so whatever trails "Speaker:" is reproduced in the meta
    // row, in JSON-LD performer.name, and in the .ics DESCRIPTION.
    const db = await eventDb({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\nSpeaker: Dr Ada, dial 555-020-9999\n\nBody text.' },
    });
    try {
      const html = await (await getEvent(db)).text();
      const s = sinks(html);
      assert.match(s.speakerRow ?? '', /555-020-9999/, 'EV-S1 fixed in the meta row');
      assert.match(s.jsonLd.performer.name, /555-020-9999/, 'EV-S1 fixed in JSON-LD performer');

      const ics = await (await getEvent(db, { query: '?add=ics' })).text();
      assert.match(ics, /555-020-9999/, 'EV-S1 fixed in the .ics export');
    } finally {
      db.close();
    }
  });

  it('does NOT leak through the .ics export body, which is built without content', async () => {
    // The counterexample that makes EV-S1 meaningful: the calendar entry is
    // deliberately content-free, so the ONLY way anything from the post reaches
    // it is the speaker channel above.
    const db = await eventDb({
      viewer: 'member',
      post: { content: 'Title chunk.\n\nPIN: 191919\n\nMeet link: https://meet.google.com/ics-aaaa-bbb' },
    });
    try {
      const ics = await (await getEvent(db, { viewer: 'member', query: '?add=ics' })).text();
      assert.ok(!ics.includes('191919'), 'the PIN reached the .ics export');
      assert.ok(!ics.includes('meet.google.com'), 'the gated Meet link reached the .ics export');
      assert.ok(!ics.includes('ics-aaaa-bbb'));
    } finally {
      db.close();
    }
  });

  it('FINDING EV-C1: an all-CRLF post loses its entire body and its og:description', async () => {
    // summarize() splits chunks on the literal '\n\n'. Content authored with
    // Windows paragraph breaks ('\r\n\r\n') contains no such sequence, so the
    // whole post collapses into chunk 0 -- which renderHtml() drops, because
    // chunk 0 is assumed to be the title. Not a leak; the opposite. The page
    // still returns 200 with a silently empty body and the generic fallback
    // description, so nothing anywhere reports the content loss.
    const crlf = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\r\n\r\nSecond paragraph with the real detail.\r\n\r\nThird paragraph.' },
    });
    assert.equal(crlf.response.status, 200);
    assert.equal(crlf.body, null, 'EV-C1 fixed: CRLF paragraphs now render');
    assert.equal(crlf.ogDescription, 'Live members-only call from Save the Uterus Club.',
      'EV-C1 fixed: og:description now carries the real content');

    const lf = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\nSecond paragraph with the real detail.\n\nThird paragraph.' },
    });
    assert.equal(lf.ogDescription, 'Second paragraph with the real detail. Third paragraph.',
      'the LF control must render, or EV-C1 is not about line endings at all');
  });
});

// =====================================================================
// C. The three named sinks, asserted independently
// =====================================================================

describe('the redaction requirement, sink by sink', () => {
  const CREDENTIALS = 'Meet link: https://meet.google.com/snk-aaaa-bbb\nDial-in: +1 555-030-1111\nPIN: 707070';
  const POST = { content: `Title chunk.\n\nWhat we will cover.\n\n${CREDENTIALS}` };

  for (const viewer of ['anonymous', 'authenticated']) {
    it(`og:description carries no joining info for a ${viewer} visitor`, async () => {
      const r = await renderEvent({ viewer, post: POST });
      for (const needle of ['snk-aaaa-bbb', 'meet.google.com', '555-030-1111', '707070']) {
        assert.ok(!appearsIn(r.ogDescription ?? '', needle), `og:description leaked ${needle}`);
      }
      assert.match(r.ogDescription ?? '', /What we will cover\./);
    });

    it(`the schema.org JSON-LD carries no joining info for a ${viewer} visitor`, async () => {
      const r = await renderEvent({ viewer, post: POST });
      assert.equal(r.jsonLdParseError, null, 'the JSON-LD did not parse');
      for (const needle of ['snk-aaaa-bbb', 'meet.google.com', '555-030-1111', '707070']) {
        assert.ok(!appearsIn(r.jsonLdRaw ?? '', needle), `JSON-LD leaked ${needle}`);
      }
      // location.url is the public landing page, never the Meet room.
      assert.equal(r.jsonLd.location['@type'], 'VirtualLocation');
      assert.equal(r.jsonLd.location.url, 'https://rrmacademy.org/events/endo-excision-call');
    });

    it(`the rendered body carries no joining info for a ${viewer} visitor`, async () => {
      const r = await renderEvent({ viewer, post: POST });
      for (const needle of ['snk-aaaa-bbb', 'meet.google.com', '555-030-1111', '707070']) {
        assert.ok(!appearsIn(r.body ?? '', needle), `body leaked ${needle}`);
      }
    });
  }

  it('a MEMBER gets the joining info in the body and nowhere else', async () => {
    const r = await renderEvent({ viewer: 'member', post: POST });

    // Over-redaction that breaks the product for paying members is also a defect.
    assert.match(r.body ?? '', /meet\.google\.com\/snk-aaaa-bbb/, 'the member lost the Meet link');
    assert.match(r.body ?? '', /555-030-1111/, 'the member lost the dial-in');
    assert.match(r.body ?? '', /707070/, 'the member lost the PIN');

    // ...and the shared, cacheable, crawlable surfaces stay scrubbed even so.
    // This is the divergence renderHtml() creates at `isMember && memberSummary`;
    // if the summary/memberSummary wires were ever crossed, only this half moves.
    for (const [name, value] of redactionSinks(r).filter(([n]) => n !== 'rendered body')) {
      for (const needle of ['snk-aaaa-bbb', '555-030-1111', '707070']) {
        assert.ok(!appearsIn(value, needle), `${name} leaked ${needle} on the member render`);
      }
    }
  });

  it('a STAFF visitor gets the same unscrubbed body as a member', async () => {
    const r = await renderEvent({ viewer: 'staff', post: POST });
    assert.match(r.body ?? '', /meet\.google\.com\/snk-aaaa-bbb/);
    assert.ok(!appearsIn(r.ogDescription ?? '', 'snk-aaaa-bbb'));
  });

  it('the member Join Call button points at event_link, which never appears in any shared sink', async () => {
    const r = await renderEvent({
      viewer: 'member',
      post: { content: 'Title chunk.\n\nBody.', event_link: 'https://meet.google.com/btn-aaaa-bbb' },
    });
    assert.equal(r.ctaPrimary, 'https://meet.google.com/btn-aaaa-bbb');
    for (const [name, value] of redactionSinks(r)) {
      assert.ok(!appearsIn(value, 'btn-aaaa-bbb'), `${name} carried the gated event_link`);
    }
  });

  it('a non-member never receives event_link anywhere in the document', async () => {
    for (const viewer of ['anonymous', 'authenticated']) {
      const r = await renderEvent({
        viewer,
        post: { content: 'Title chunk.\n\nBody.', event_link: 'https://meet.google.com/non-aaaa-bbb' },
      });
      assert.ok(!r.html.includes('non-aaaa-bbb'), `event_link reached the ${viewer} document`);
    }
  });
});

// =====================================================================
// D. escapeHtml at every interpolation site, and the JSON-LD escape
// =====================================================================

describe('escaping', () => {
  const HOSTILE = `Zap <img src=x onerror=alert(1)> & "quoted" & 'single'`;

  it('escapes the title everywhere it is interpolated', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { title: HOSTILE, content: 'T.\n\nBody.' } });
    assert.ok(!r.html.includes('<img src=x'), 'raw markup reached the document');
    assert.match(r.h1 ?? '', /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(r.ogTitle ?? '', /&lt;img/);
    assert.match(r.docTitle ?? '', /&lt;img/);
    assert.ok((r.ogImage ?? '').length > 0);
    // og:image:alt is the title too.
    assert.match(r.html, /<meta property="og:image:alt" content="[^"]*&lt;img/);
    // The single quote must be escaped, or it terminates nothing here but does
    // the moment an attribute is single-quoted.
    assert.match(r.h1 ?? '', /&#39;single&#39;/);
    assert.match(r.h1 ?? '', /&amp; &quot;quoted&quot; &amp;/);
  });

  it('escapes the description in every meta attribute', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: `T.\n\n${HOSTILE}` },
    });
    assert.ok(!r.html.includes('<img src=x'));
    for (const value of [r.ogDescription, r.twitterDescription, r.metaDescription]) {
      assert.match(value ?? '', /&lt;img src=x onerror=alert\(1\)&gt;/);
      assert.match(value ?? '', /&quot;quoted&quot;/);
    }
  });

  it('escapes body prose and the speaker row', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: `T.\n\nSpeaker: ${HOSTILE}\n\n${HOSTILE}` },
    });
    assert.ok(!r.html.includes('<img src=x'));
    assert.match(r.speakerRow ?? '', /&lt;img src=x/);
    assert.match(r.body ?? '', /&lt;img src=x/);
  });

  it('escapes the flyer src and keeps a hostile og_image_url inert', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { og_image_url: 'https://cdn.example/a.png?x="><script>alert(1)</script>', content: 'T.\n\nB.' },
    });
    assert.ok(!r.html.includes('"><script>'), 'the attribute was broken out of');
    assert.match(r.flyerSrc ?? '', /&quot;&gt;&lt;script&gt;/);
    assert.match(r.ogImage ?? '', /&quot;&gt;&lt;script&gt;/);
  });

  it('renders markdown links as anchors, escaping label and href', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'T.\n\nRead [the "study" & more](https://example.org/a?b=1&c=2) today.' },
    });
    assert.match(r.body ?? '',
      /<a class="link" href="https:\/\/example\.org\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">the &quot;study&quot; &amp; more<\/a>/);
    assert.match(r.body ?? '', /<p>Read <a /, 'text before the link was dropped');
    assert.match(r.body ?? '', /<\/a> today\.<\/p>/, 'text after the link was dropped');
  });

  it('refuses a javascript: markdown link and re-renders it as escaped text', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'T.\n\nClick [here](javascript:alert(1)) now.' },
    });
    assert.ok(!(r.body ?? '').includes('<a '), 'a javascript: URL became a live anchor');
    assert.match(r.body ?? '', /\[here\]\(javascript:alert\(1\)?\)?/);
  });

  it('refuses a markdown link whose URL does not parse', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'T.\n\nClick [here](not-a-url-at-all) now.' },
    });
    assert.ok(!(r.body ?? '').includes('<a '), 'an unparseable URL became a live anchor');
    assert.match(r.body ?? '', /\[here\]\(not-a-url-at-all\)/);
  });

  // --- the case that matters most: JSON-LD is JSON, not HTML ---------------

  it('the schema.org JSON-LD cannot be broken out of', async () => {
    // HTML escaping is the WRONG escape inside <script type="application/ld+json">.
    // The page uses JSON.stringify (which handles " and \) and then rewrites every
    // `<` to < (which handles </script>). Both halves are asserted, because
    // dropping either one is a script-injection hole on a public page.
    const HOSTILE_TITLES = [
      'Quote " inside',
      'Backslash \\ inside',
      'Break </script><script>alert(1)</script>',
      'Inject ","@type":"FakeType","evil":"',
      'Both \\" together',
    ];
    for (const title of HOSTILE_TITLES) {
      const r = await renderEvent({ viewer: 'anonymous', post: { title, content: 'T.\n\nB.' } });
      assert.equal(r.jsonLdParseError, null, `JSON-LD stopped parsing for ${JSON.stringify(title)}`);
      assert.equal(r.jsonLd.name, title, `the title round-tripped wrong for ${JSON.stringify(title)}`);
      assert.equal(r.jsonLd['@type'], 'Event', 'an injected key displaced @type');
      assert.equal(r.jsonLd.FakeType, undefined);
      assert.equal(r.jsonLd.evil, undefined);
      assert.ok(!r.jsonLdRaw.includes('</script>'),
        `the </script> literal survived into the script element for ${JSON.stringify(title)}`);
      assert.ok(!r.jsonLdRaw.includes('<'),
        'a raw < inside the ld+json element can terminate the element in an HTML parser');
    }
  });

  it('the JSON-LD escape covers the description and the speaker too, not just the title', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'T.\n\nSpeaker: Dr </script><b>X\n\nAbout </script> the topic' },
    });
    assert.equal(r.jsonLdParseError, null);
    assert.ok(!r.jsonLdRaw.includes('</script>'));
    assert.match(r.jsonLd.description, /<\/script>/, 'the payload should survive as DATA, escaped');
    assert.match(r.jsonLd.performer.name, /<\/script>/);
  });

  it('HTML-escapes rather than JSON-escapes in HTML attributes (the two are not interchangeable)', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { title: 'A "B" C', content: 'T.\n\nB.' } });
    assert.match(r.ogTitle ?? '', /A &quot;B&quot; C/, 'the attribute was not HTML-escaped');
    assert.equal(r.jsonLd.name, 'A "B" C', 'the JSON-LD was HTML-escaped, which corrupts the data');
  });
});

// =====================================================================
// E. The four visitor tiers and the CTA each one receives
// =====================================================================

describe('visitor tiers, reached through the real membership gate', () => {
  const FUTURE_POST = { content: 'T.\n\nBody.', event_date: FUTURE_DATE };

  it('anonymous: Join STUC, plus a sign-in link back to this event', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: FUTURE_POST });
    assert.equal(r.ctaPrimary, 'https://rrmacademy.org/save-the-uterus-club');
    assert.equal(r.ctaPrimaryLabel, 'Join Save the Uterus Club to Watch');
    assert.equal(r.ctaSecondary,
      'https://rrmacademy.org/login?redirect=' + encodeURIComponent('/events/endo-excision-call'));
    assert.equal(r.ctaSecondaryLabel, 'Already a member? Sign in');
    assert.match(r.ctaNote ?? '', /Members attend the live call/);
  });

  it('authenticated non-member: upgrade prompt, no sign-in link', async () => {
    const r = await renderEvent({ viewer: 'authenticated', post: FUTURE_POST });
    assert.equal(r.ctaPrimary, 'https://rrmacademy.org/save-the-uterus-club');
    assert.equal(r.ctaSecondary, 'https://rrmacademy.org/community/events');
    assert.equal(r.ctaSecondaryLabel, 'See all events');
    assert.equal(r.ctaNote,
      'Members attend the live call and get the recording, transcript, and Gemini notes afterward.');
    assert.ok(!r.html.includes('Already a member? Sign in'),
      'a logged-in visitor was told to sign in');
  });

  it('member: Join Call on the gated link, opened in a new tab with rel=noopener', async () => {
    const r = await renderEvent({ viewer: 'member', post: FUTURE_POST });
    assert.equal(r.ctaPrimary, 'https://meet.google.com/gat-eded-xyz');
    assert.equal(r.ctaPrimaryLabel, 'Join Call');
    assert.match(r.html, /class="btn btn--primary"[^>]*target="_blank" rel="noopener noreferrer"/);
    assert.equal(r.ctaNote, null, 'the member CTA has no note');
  });

  it('staff: the same Join Call, reached by role rather than by subscription', async () => {
    const r = await renderEvent({ viewer: 'staff', post: FUTURE_POST });
    assert.equal(r.ctaPrimary, 'https://meet.google.com/gat-eded-xyz');
    assert.equal(r.ctaPrimaryLabel, 'Join Call');
  });

  it('member with no event_link falls back to the events index rather than an empty href', async () => {
    const r = await renderEvent({ viewer: 'member', post: { ...FUTURE_POST, event_link: null } });
    assert.equal(r.ctaPrimary, 'https://rrmacademy.org/community/events');
  });

  it('a blocked account is served the anonymous page, not the member page', async () => {
    const db = await eventDb({
      viewer: 'member',
      post: FUTURE_POST,
      seed(s) { s.prepare('UPDATE user SET blocked = 1 WHERE id = ?').run('usr_visitor'); },
    });
    try {
      const s = sinks(await (await getEvent(db, { viewer: 'member' })).text());
      assert.equal(s.ctaPrimary, 'https://rrmacademy.org/save-the-uterus-club');
      assert.equal(s.ctaSecondaryLabel, 'Already a member? Sign in',
        'a blocked account must fall all the way back to anonymous, not to authenticated');
    } finally { db.close(); }
  });

  it('an expired session is served the anonymous page', async () => {
    const db = await eventDb({ viewer: 'member', post: FUTURE_POST });
    try {
      db._sqlite.prepare('UPDATE session SET expires_at = ?').run(Math.floor(Date.now() / 1000) - 60);
      const s = sinks(await (await getEvent(db, { viewer: 'member' })).text());
      assert.equal(s.ctaPrimaryLabel, 'Join Save the Uterus Club to Watch');
    } finally { db.close(); }
  });

  it('an account blocked BETWEEN the two reads falls back to anonymous, not authenticated', async () => {
    // classifyVisitor re-reads the user after requireMember has already refused
    // it. On one consistent snapshot that second read can only agree, so the
    // `!user || user.blocked` arm is reachable solely through a concurrent
    // write -- an admin blocking an abusive account with a request in flight.
    // _d1-sqlite.mjs's interleave hook exists for exactly this; the UPDATE is a
    // real statement against the real engine, interleave only decides when.
    const CLASSIFY_READ = 'SELECT id, email, role, blocked FROM user WHERE id = ?';
    let armed = false;
    const db = await eventDb({
      viewer: 'authenticated',
      post: FUTURE_POST,
      interleave({ sql, db: handle }) {
        if (!armed && sql.includes(CLASSIFY_READ)) {
          armed = true;
          handle.prepare('UPDATE user SET blocked = 1 WHERE id = ?').run('usr_visitor');
        }
      },
    });
    try {
      const s = sinks(await (await getEvent(db, { viewer: 'authenticated' })).text());
      assert.ok(armed, 'the interleave never fired; classifyVisitor no longer issues that read');
      assert.equal(s.ctaSecondaryLabel, 'Already a member? Sign in',
        'the mid-flight block was ignored and the visitor stayed authenticated');
    } finally { db.close(); }
  });

  it('an account deleted BETWEEN the two reads also falls back to anonymous', async () => {
    const CLASSIFY_READ = 'SELECT id, email, role, blocked FROM user WHERE id = ?';
    let armed = false;
    const db = await eventDb({
      viewer: 'authenticated',
      post: FUTURE_POST,
      interleave({ sql, db: handle }) {
        if (!armed && sql.includes(CLASSIFY_READ)) {
          armed = true;
          handle.prepare('DELETE FROM user WHERE id = ?').run('usr_visitor');
        }
      },
    });
    try {
      const s = sinks(await (await getEvent(db, { viewer: 'authenticated' })).text());
      assert.ok(armed);
      assert.equal(s.ctaSecondaryLabel, 'Already a member? Sign in');
    } finally { db.close(); }
  });

  it('past event, member: pointed at the archive, with no Join Call', async () => {
    const r = await renderEvent({ viewer: 'member', post: { content: 'T.\n\nB.', event_date: PAST_DATE } });
    assert.equal(r.ctaPrimary, 'https://rrmacademy.org/community/events');
    assert.equal(r.ctaPrimaryLabel, 'See member archive');
    assert.equal(r.ctaSecondary, null, 'the past-member CTA has no secondary button');
    assert.match(r.ctaNote ?? '', /Members can find the recording in the community archive\./);
    assert.ok(!r.html.includes('gat-eded-xyz'), 'the Meet link is still being served after the event');
  });

  it('past event, anonymous: join-to-watch, with the archive as secondary', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { content: 'T.\n\nB.', event_date: PAST_DATE } });
    assert.equal(r.ctaPrimary, 'https://rrmacademy.org/save-the-uterus-club');
    assert.equal(r.ctaSecondary, 'https://rrmacademy.org/community/events');
    assert.match(r.ctaNote ?? '', /^This event has ended\./);
  });

  it('the one-hour grace window keeps a just-started event in its live state', async () => {
    // isPast is `startMs < Date.now() - 3600_000`, so an event that began 30
    // minutes ago is still "live" and a member still gets Join Call. A test that
    // used "yesterday" and "tomorrow" would never touch that boundary.
    const justStarted = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const live = await renderEvent({ viewer: 'member', post: { content: 'T.\n\nB.', event_date: justStarted } });
    assert.equal(live.ctaPrimaryLabel, 'Join Call');

    const longOver = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    const over = await renderEvent({ viewer: 'member', post: { content: 'T.\n\nB.', event_date: longOver } });
    assert.equal(over.ctaPrimaryLabel, 'See member archive');
  });

  it('an unparseable event_date is treated as NOT past (isPast needs a finite start)', async () => {
    const r = await renderEvent({ viewer: 'member', post: { content: 'T.\n\nB.', event_date: 'sometime in March' } });
    assert.equal(r.ctaPrimaryLabel, 'Join Call');
    assert.equal(r.dateRow, 'sometime in March', 'formatDate should pass an unparseable value through verbatim');
  });

  it('the response varies on Cookie, because the body it returns does', async () => {
    const r = await renderEvent({ viewer: 'member', post: { content: 'T.\n\nB.' } });
    assert.equal(r.response.headers.get('Vary'), 'Cookie');
    assert.equal(r.response.headers.get('Cache-Control'), 'private, max-age=0, must-revalidate');
    assert.equal(r.response.headers.get('X-Robots-Tag'), 'index, follow');
    assert.equal(r.response.headers.get('Content-Type'), 'text/html; charset=utf-8');
  });
});

// =====================================================================
// F. 404, 503, and the redirect
// =====================================================================

describe('lookup, failure and redirect paths', () => {
  it('404s when the slug is missing', async () => {
    const db = await eventDb();
    try {
      const res = await getEvent(db, { slug: undefined });
      assert.equal(res.status, 404);
      assert.equal(await res.text(), 'Not Found');
    } finally { db.close(); }
  });

  it('404s when the slug is not a string', async () => {
    const db = await eventDb();
    try {
      assert.equal((await getEvent(db, { slug: ['a', 'b'] })).status, 404);
    } finally { db.close(); }
  });

  it('404s a slug over the 200-character cap, at the boundary', async () => {
    const db = await eventDb();
    try {
      assert.equal((await getEvent(db, { slug: 'x'.repeat(201) })).status, 404,
        '201 characters must be refused');
      // 200 characters is accepted by the guard and then simply not found,
      // which is what proves the cap is `> 200` and not `>= 200`.
      assert.equal((await getEvent(db, { slug: 'x'.repeat(200) })).status, 404);
      const sqlSeen = db._calls.some((c) => c.bound?.[0] === 'x'.repeat(200));
      assert.ok(sqlSeen, 'a 200-character slug should reach the query; the cap is off by one');
      assert.ok(!db._calls.some((c) => c.bound?.[0] === 'x'.repeat(201)),
        'a 201-character slug must be refused before the database is touched');
    } finally { db.close(); }
  });

  it('503s when the DB binding is absent, rather than rendering an empty page', async () => {
    const db = await eventDb();
    try {
      const res = await getEvent(db, { env: { DB: undefined } });
      assert.equal(res.status, 503);
      assert.equal(await res.text(), 'Service Unavailable');
    } finally { db.close(); }
  });

  it('503s and logs when the D1 lookup throws', async () => {
    // A throwing stub, not the SQLite harness: _d1-sqlite.mjs's own header says
    // a test that needs "D1 threw" should use one, because the engine will not
    // produce a network error on demand.
    const throwingDb = {
      prepare() {
        return { bind() { return this; }, async first() { throw new Error('D1_ERROR: network'); } };
      },
    };
    const original = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args.join(' '));
    try {
      const res = await getEvent(throwingDb, {});
      assert.equal(res.status, 503);
      assert.equal(await res.text(), 'Service Unavailable');
      assert.ok(
        logged.some((l) => l.includes('events page: D1 lookup failed') && l.includes('D1_ERROR: network')),
        'the outage was swallowed silently; the log line is the only operator signal'
      );
    } finally { console.error = original; }
  });

  it('404s when no event row matches', async () => {
    const db = await eventDb();
    try {
      assert.equal((await getEvent(db, { slug: 'no-such-event' })).status, 404);
    } finally { db.close(); }
  });

  it('only serves stuc events, not other channels or post types', async () => {
    for (const post of [{ channel: 'general' }, { type: 'discussion' }]) {
      const db = await eventDb({ post: { ...post, slug: 'wrong-shape' } });
      try {
        assert.equal((await getEvent(db, { slug: 'wrong-shape' })).status, 404,
          `${JSON.stringify(post)} was served by the public events route`);
      } finally { db.close(); }
    }
  });

  it('finds an event by its slug case-insensitively without redirecting', async () => {
    const db = await eventDb({ post: { slug: 'Endo-Excision-Call' } });
    try {
      const res = await getEvent(db, { slug: 'endo-excision-call' });
      assert.equal(res.status, 200, 'the slug lookup lost its COLLATE NOCASE');
    } finally { db.close(); }
  });

  it('301s /events/<uuid> to /events/<slug>', async () => {
    const db = await eventDb({ post: { id: 'a1b2c3d4-uuid', slug: 'the-real-slug' } });
    try {
      const res = await getEvent(db, { slug: 'a1b2c3d4-uuid' });
      assert.equal(res.status, 301);
      assert.equal(res.headers.get('Location'), 'https://rrmacademy.org/events/the-real-slug');
    } finally { db.close(); }
  });

  it('serves a slugless event by id, with the id in the canonical URL', async () => {
    const db = await eventDb({ post: { id: 'legacy-id-1', slug: null, content: 'T.\n\nB.' } });
    try {
      const res = await getEvent(db, { slug: 'legacy-id-1' });
      assert.equal(res.status, 200, 'a slugless row must not redirect to itself');
      const s = sinks(await res.text());
      assert.equal(s.canonical, 'https://rrmacademy.org/events/legacy-id-1');
      assert.equal(s.icsHref, '/events/legacy-id-1/?add=ics');
    } finally { db.close(); }
  });
});

// =====================================================================
// G. The .ics calendar export
// =====================================================================

describe('the .ics export', () => {
  it('serves a downloadable, noindexed calendar entry', async () => {
    const db = await eventDb({ post: { content: 'T.\n\nSpeaker: Dr Ada\n\nBody.' } });
    try {
      const res = await getEvent(db, { query: '?add=ics' });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('Content-Type'), 'text/calendar; charset=utf-8');
      assert.equal(res.headers.get('Content-Disposition'), 'attachment; filename="endo-excision-call.ics"');
      assert.equal(res.headers.get('Cache-Control'), 'public, max-age=3600');
      assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');

      const ics = await res.text();
      assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'), 'iCalendar requires CRLF line endings');
      assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
      const lines = ics.split('\r\n');
      assert.ok(lines.includes('UID:stuc-endo-excision-call@rrmacademy.org'));
      assert.ok(lines.includes('DTSTART:20990301T180000Z'));
      assert.ok(lines.includes('DTEND:20990301T190000Z'), 'the export should assume a one-hour event');
      assert.ok(lines.includes('LOCATION:https://rrmacademy.org/events/endo-excision-call/'));
      assert.ok(lines.includes('URL:https://rrmacademy.org/events/endo-excision-call/'));
      assert.ok(lines.includes('STATUS:CONFIRMED'));
      assert.ok(lines.some((l) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(l)));
      assert.ok(ics.includes('Save the Uterus Club live call with Dr Ada.'));
    } finally { db.close(); }
  });

  it('escapes the iCalendar special characters in SUMMARY and DESCRIPTION', async () => {
    const db = await eventDb({
      post: {
        title: 'Endo, Part 2; a "deep" dive \\ notes',
        content: 'T.\n\nSpeaker: Dr Ada, MD; PhD\n\nBody.',
      },
    });
    try {
      const ics = await (await getEvent(db, { query: '?add=ics' })).text();
      assert.ok(ics.includes('SUMMARY:Endo\\, Part 2\\; a "deep" dive \\\\ notes'),
        `SUMMARY was not iCal-escaped: ${/SUMMARY:.*/.exec(ics)?.[0]}`);
      assert.ok(ics.includes('Dr Ada\\, MD\\; PhD'), 'DESCRIPTION was not iCal-escaped');
    } finally { db.close(); }
  });

  it('serves the same calendar entry to an anonymous visitor as to a member, with no Meet link', async () => {
    const anonDb = await eventDb({ viewer: 'anonymous' });
    const memberDb = await eventDb({ viewer: 'member' });
    try {
      const strip = (s) => s.replace(/DTSTAMP:[^\r]*/, 'DTSTAMP:X');
      const anon = strip(await (await getEvent(anonDb, { query: '?add=ics' })).text());
      const member = strip(await (await getEvent(memberDb, { viewer: 'member', query: '?add=ics' })).text());
      assert.equal(anon, member, 'the calendar export is meant to be tier-agnostic');
      assert.ok(!anon.includes('meet.google.com'));
    } finally { anonDb.close(); memberDb.close(); }
  });

  it('404s the calendar export when the event date cannot be parsed', async () => {
    const db = await eventDb({ post: { event_date: 'next Tuesday-ish' } });
    try {
      const res = await getEvent(db, { query: '?add=ics' });
      assert.equal(res.status, 404,
        'an unparseable date must refuse the export rather than emit DTSTART:NaN');
      assert.equal(await res.text(), 'Not Found');
    } finally { db.close(); }
  });

  it('falls back to event.ics when the slug sanitises to nothing', async () => {
    const db = await eventDb({ post: { slug: '___' } });
    try {
      const res = await getEvent(db, { slug: '___', query: '?add=ics' });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('Content-Disposition'), 'attachment; filename="event.ics"');
    } finally { db.close(); }
  });

  it('strips path characters out of the download filename', async () => {
    const db = await eventDb({ post: { slug: 'a/../b c.ics' } });
    try {
      const res = await getEvent(db, { slug: 'a/../b c.ics', query: '?add=ics' });
      assert.equal(res.headers.get('Content-Disposition'), 'attachment; filename="abcics.ics"',
        'the slug is spliced into a Content-Disposition filename, so a slash or a quote surviving '
        + 'the sanitiser would be a header-injection foothold');
    } finally { db.close(); }
  });

  it('exports a slugless event under its id, and names the file event.ics', async () => {
    const db = await eventDb({ post: { id: 'legacy-id-2', slug: null } });
    try {
      const res = await getEvent(db, { slug: 'legacy-id-2', query: '?add=ics' });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('Content-Disposition'), 'attachment; filename="event.ics"');
      const ics = await res.text();
      assert.ok(ics.includes('UID:stuc-legacy-id-2@rrmacademy.org'));
      assert.ok(ics.includes('URL:https://rrmacademy.org/events/legacy-id-2/'));
      assert.ok(ics.includes('LOCATION:https://rrmacademy.org/events/legacy-id-2/'));
      assert.ok(ics.includes('Join live inside Save the Uterus Club: https://rrmacademy.org/events/legacy-id-2/'));
    } finally { db.close(); }
  });

  it('exports a titleless event under a generic SUMMARY', async () => {
    const db = await eventDb({ post: { title: '' } });
    try {
      const ics = await (await getEvent(db, { query: '?add=ics' })).text();
      assert.ok(ics.includes('SUMMARY:Save the Uterus Club event'),
        `an empty title produced: ${/SUMMARY:.*/.exec(ics)?.[0]}`);
    } finally { db.close(); }
  });

  it('any other ?add value renders the page normally', async () => {
    const db = await eventDb({ post: { content: 'T.\n\nB.' } });
    try {
      const res = await getEvent(db, { query: '?add=gcal' });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
    } finally { db.close(); }
  });

  it('offers Google Calendar and .ics links on the page, neither carrying the Meet link', async () => {
    const r = await renderEvent({ viewer: 'member', post: { content: 'T.\n\nSpeaker: Dr Ada\n\nB.' } });
    assert.equal(r.icsHref, '/events/endo-excision-call/?add=ics');
    const gcal = decodeURIComponent(r.gcalHref.replace(/&amp;/g, '&'));
    assert.match(gcal, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
    assert.match(gcal, /dates=20990301T180000Z\/20990301T190000Z/);
    assert.match(gcal, /text=Endometriosis Excision, Start to Finish/);
    assert.match(gcal, /location=https:\/\/rrmacademy\.org\/events\/endo-excision-call\//);
    assert.ok(!gcal.includes('meet.google.com'), 'the calendar template carried the gated Meet link');
  });

  it('omits the add-to-calendar block entirely when the date cannot be parsed', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { content: 'T.\n\nB.', event_date: 'TBD' } });
    assert.equal(r.gcalHref, null);
    assert.equal(r.icsHref, null, 'an .ics link that 404s must not be offered');
    assert.equal(r.jsonLd.startDate, 'TBD');
    assert.equal(r.jsonLd.endDate, null);
  });
});

// =====================================================================
// H. Everything else renderHtml decides
// =====================================================================

describe('rendering details', () => {
  it('falls back through title, then first content chunk, then a constant', async () => {
    const fromColumn = await renderEvent({ viewer: 'anonymous', post: { title: 'Column Title', content: 'Chunk Title\n\nB.' } });
    assert.equal(fromColumn.h1, 'Column Title');

    const fromChunk = await renderEvent({ viewer: 'anonymous', post: { title: '', content: 'Chunk Title\n\nB.' } });
    assert.equal(fromChunk.h1, 'Chunk Title');

    const fromConstant = await renderEvent({ viewer: 'anonymous', post: { title: '', content: null } });
    assert.equal(fromConstant.h1, 'Save the Uterus Club Event');
    assert.equal(fromConstant.body, null);
    assert.equal(fromConstant.ogDescription, 'Live members-only call from Save the Uterus Club.');
  });

  it('caps the description at 300 characters', async () => {
    const long = 'w'.repeat(400);
    const r = await renderEvent({ viewer: 'anonymous', post: { content: `T.\n\n${long}` } });
    assert.equal((r.ogDescription ?? '').length, 300);
  });

  it('collapses whitespace when joining chunks into the description', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { content: 'T.\n\nOne\n  two\tthree\n\nfour' } });
    assert.equal(r.ogDescription, 'One two three four');
  });

  it('takes the flyer from og_image_url, and absolutises each URL shape', async () => {
    const absolute = await renderEvent({ viewer: 'anonymous', post: { og_image_url: 'https://cdn.example/a.png', content: 'T.\n\nB.' } });
    assert.equal(absolute.flyerSrc, 'https://cdn.example/a.png');
    assert.equal(absolute.ogImage, 'https://cdn.example/a.png');

    const rooted = await renderEvent({ viewer: 'anonymous', post: { og_image_url: '/images/a.png', content: 'T.\n\nB.' } });
    assert.equal(rooted.flyerSrc, 'https://rrmacademy.org/images/a.png');

    const relative = await renderEvent({ viewer: 'anonymous', post: { og_image_url: 'images/a.png', content: 'T.\n\nB.' } });
    assert.equal(relative.flyerSrc, 'https://rrmacademy.org/images/a.png');
  });

  it('falls back to the first markdown image in the content, then to the branded card', async () => {
    const fromContent = await renderEvent({
      viewer: 'anonymous',
      post: { og_image_url: null, content: 'T.\n\n![one](https://cdn.example/one.png) ![two](https://cdn.example/two.png)\n\nB.' },
    });
    assert.equal(fromContent.flyerSrc, 'https://cdn.example/one.png',
      'the SECOND image displaced the first; the !firstImage guard is inverted');
    assert.equal(fromContent.ogImage, 'https://cdn.example/one.png');
    assert.ok(!(fromContent.body ?? '').includes('![one]'), 'the image markdown was left in the prose');

    const fallback = await renderEvent({ viewer: 'anonymous', post: { og_image_url: null, content: 'T.\n\nB.' } });
    assert.equal(fallback.flyerSrc, null, 'no flyer element should be emitted with no image');
    assert.equal(fallback.ogImage, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8');
    assert.equal(fallback.jsonLd.image, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8');
  });

  it('prefers the speaker column over the Speaker: line in the content', async () => {
    const fromColumn = await renderEvent({
      viewer: 'anonymous',
      post: { speaker: 'Dr Column', content: 'T.\n\nSpeaker: Dr Content\n\nB.' },
    });
    assert.equal(fromColumn.speakerRow, 'Dr Column');
    assert.equal(fromColumn.jsonLd.performer.name, 'Dr Column');

    const fromContent = await renderEvent({
      viewer: 'anonymous',
      post: { speaker: null, content: 'T.\n\nSpeaker: Dr Content\n\nB.' },
    });
    assert.equal(fromContent.speakerRow, 'Dr Content');
  });

  it('omits the speaker row and the JSON-LD performer when there is no speaker', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { speaker: null, content: 'T.\n\nB.' } });
    assert.equal(r.speakerRow, null);
    assert.equal('performer' in r.jsonLd, false);
  });

  it('formats the event date in Eastern time', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { content: 'T.\n\nB.', event_date: '2026-08-12T22:30:00.000Z' } });
    assert.equal(r.dateRow, 'Wednesday, August 12, 2026 at 6:30 PM Eastern');
  });

  it('emits a complete, parseable Event graph', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { content: 'T.\n\nAbout the call.' } });
    const ld = r.jsonLd;
    assert.equal(ld['@context'], 'https://schema.org');
    assert.equal(ld['@type'], 'Event');
    assert.equal(ld.name, 'Endometriosis Excision, Start to Finish');
    assert.equal(ld.description, 'About the call.');
    assert.equal(ld.startDate, '2099-03-01T18:00:00.000Z');
    assert.equal(ld.endDate, '2099-03-01T19:00:00.000Z');
    assert.equal(ld.eventStatus, 'https://schema.org/EventScheduled');
    assert.equal(ld.eventAttendanceMode, 'https://schema.org/OnlineEventAttendanceMode');
    assert.equal(ld.organizer.name, 'Save the Uterus Club');
    assert.equal(ld.offers.price, '0');
    assert.equal(ld.offers.priceCurrency, 'USD');
    assert.equal(ld.offers.availability, 'https://schema.org/LimitedAvailability');
    assert.match(ld.offers.validFrom, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('the canonical, og:url and JSON-LD location agree on one URL', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { content: 'T.\n\nB.' } });
    const expected = 'https://rrmacademy.org/events/endo-excision-call';
    assert.equal(r.canonical, expected);
    assert.equal(r.jsonLd.location.url, expected);
    assert.match(r.html, new RegExp(`<meta property="og:url" content="${expected}">`));
  });
});

// =====================================================================
// I. functions/events/_tracking.js
// =====================================================================

describe('_tracking.js -- the instrumentation injected into every rendered page', () => {
  const SOURCE = readFileSync(new URL('../functions/events/_tracking.js', import.meta.url), 'utf8');

  it('exports two plain string constants and nothing that takes an argument', async () => {
    const mod = await import('../functions/events/_tracking.js');
    assert.deepEqual(Object.keys(mod).sort(), ['TRACKING_BODY', 'TRACKING_HEAD']);
    assert.equal(typeof TRACKING_HEAD, 'string');
    assert.equal(typeof TRACKING_BODY, 'string');
  });

  it('cannot inject an unescaped value, because it interpolates nothing', async () => {
    // This is the whole safety argument for a module whose output is spliced
    // raw into the document: there is no seam for caller data to enter. The
    // ONLY `${` in the file is inside the header comment, so the exported
    // values are compile-time constants.
    const withoutComments = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!withoutComments.includes('${'),
      'an interpolation appeared in _tracking.js; a caller-supplied value can now reach the page raw');
    assert.ok(!TRACKING_HEAD.includes('${'));
    assert.ok(!TRACKING_BODY.includes('${'));
    assert.ok(!TRACKING_BODY.includes('`'), 'a backtick would break the event page template that embeds this');
  });

  it('is injected byte-for-byte into the head and the body of a rendered page', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { content: 'T.\n\nB.' } });
    assert.ok(r.html.includes(TRACKING_HEAD), 'TRACKING_HEAD is not in the document');
    assert.ok(r.html.includes(TRACKING_BODY), 'TRACKING_BODY is not in the document');
    assert.ok(r.html.indexOf(TRACKING_HEAD) < r.html.indexOf('</head>'), 'TRACKING_HEAD escaped the head');
    assert.ok(r.html.indexOf(TRACKING_BODY) > r.html.indexOf('<body>'));
    assert.ok(r.html.indexOf(TRACKING_BODY) < r.html.indexOf('</body>'));
  });

  it('is injected identically for every visitor tier', async () => {
    for (const viewer of ['anonymous', 'authenticated', 'member', 'staff']) {
      const r = await renderEvent({ viewer, post: { content: 'T.\n\nB.' } });
      assert.ok(r.html.includes(TRACKING_BODY), `TRACKING_BODY missing for ${viewer}`);
    }
  });

  it('preconnects to the fingerprint worker rather than embedding a third-party tag', async () => {
    assert.equal(
      TRACKING_HEAD,
      '<link rel="preconnect" href="https://fp.rrmacademy.org" crossorigin>\n'
      + '<link rel="dns-prefetch" href="https://fp.rrmacademy.org">'
    );
  });

  it('keeps the identity keys that stitch an event hit to the rest of the site', async () => {
    // These four literals are the contract with BaseLayout.astro / ga-session.ts.
    // Renaming one here silently splits every event visitor into a second GA4
    // user and a second fingerprint visitor, with nothing failing.
    for (const key of ['rrm_vid', 'rrm_ga_cid', 'rrm_ga_ses', 'fp_in_flight']) {
      assert.ok(TRACKING_BODY.includes(`'${key}'`), `identity key ${key} is missing`);
    }
  });

  it('honours GPC for the fingerprint and Clarity, and DNT for GA4', async () => {
    const blocks = TRACKING_BODY.split('<script>').slice(1);
    assert.equal(blocks.length, 3, 'the snippet count changed; re-check which block honours which signal');
    const [fingerprint, ga4, clarity] = blocks;
    assert.match(fingerprint, /navigator\.globalPrivacyControl === true\) return;/);
    assert.match(clarity, /navigator\.globalPrivacyControl === true\) return;/);
    assert.match(ga4, /navigator\.doNotTrack === '1' \|\| window\.doNotTrack === '1'\) return;/);
    assert.match(clarity, /h === 'localhost' \|\| h === '127\.0\.0\.1' \|\| h\.endsWith\('\.pages\.dev'\)/);
  });

  it('posts GA4 to the first-party endpoint only, never to a Google host', async () => {
    assert.ok(TRACKING_BODY.includes("sendBeacon('/api/track'"));
    assert.ok(TRACKING_BODY.includes("fetch('/api/track'"));
    assert.ok(!TRACKING_BODY.includes('google-analytics.com'), 'a third-party analytics host reappeared');
    assert.ok(!TRACKING_BODY.includes('googletagmanager.com'));
  });
});

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
 * in body, og:description, or JSON-LD". It is enforced by a denylist over free
 * text a human typed into an admin form. Denylist redaction is silent on any
 * format its author did not anticipate: nothing throws, nothing logs, the page
 * renders 200, and the credential is simply there. So this suite does two
 * separate jobs, and keeps them separate on purpose:
 *
 *   1. PROVE the scrubber redacts what it claims (describe blocks A and A2).
 *   2. HUNT for formats it still misses (describe block B), and report what is
 *      found HONESTLY. The leak assertions there assert that the credential IS
 *      present, because that is what the deployed code does today. They are
 *      findings written as executable evidence, not endorsements. Each one says
 *      in its failure message what to do when it goes green.
 *
 * THE OTHER HALF OF THE CONTRACT LIVES IN ANOTHER FILE
 * ----------------------------------------------------
 * Every assertion here pushes in one direction: redact more. Pushed alone it
 * produces a scrubber that deletes clinical prose, which is exactly how the
 * first attempt at widening this redaction was rejected -- it scrubbed the talk
 * title "Teams-Based Care in RRM" to the empty string. The counterweight is
 * test/events-page-over-redaction.test.js, and a change to the scrubber is only
 * finished when BOTH files are green.
 *
 * THE RULE THE SCRUBBER NOW FOLLOWS
 * ---------------------------------
 * A LABEL ALONE IS NOT A CREDENTIAL. A label is removed only when followed by a
 * CREDENTIAL-SHAPED VALUE -- a URL, a tel: URI, or a digit run long enough to
 * be a PIN or a phone number. Image srcs are judged on the parsed HOST only,
 * never on a path or a filename. Cases below are written against that rule, so
 * a case that asserts "X is redacted" should also make clear WHICH half of the
 * rule earned the redaction.
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
 * COVERAGE, AND THE DEFENSIVE BRANCHES NOT REACHABLE FROM onRequestGet
 * --------------------------------------------------------------------
 * Both files reach 100% lines / 100% statements / 100% functions across this
 * file plus events-page-over-redaction.test.js. A handful of DEFENSIVE branches
 * remain uncovered, and each is unreachable through the module's only entry
 * point rather than merely untested:
 *
 *   escapeHtml's `s == null` guard. Every call site passes either a
 *   locally-computed string (title/description/canonical/ogImage, each with its
 *   own `||` fallback) or a value already guarded by a truthiness test in the
 *   same expression (speaker, cta.note, cta.secondaryLabel, the flyer src).
 *
 *   buildGoogleCalUrl's `title || ...`, `details || ''`, `location || ''`. Its
 *   single call site passes `title` (already defaulted through safeTitle),
 *   `calDescription` and `eventsUrl` (template literals with constant
 *   prefixes) -- none can be falsy.
 *
 *   icsEscape's `s == null` ternary. Its six call sites are all inside
 *   buildICS, whose single call site supplies seven non-null values.
 *
 *   `.chunks || []` and the `memberSummary` falsy arm in renderHtml.
 *   summarize() returns `chunks` on both of its return paths, and renderHtml's
 *   single call site always passes memberSummary.
 *
 *   isConferencingHost's `hostname || ''` / `pathname || ''`, and
 *   redactLabelledCredential's `.match(/\d/g) || []`. A hostname and a pathname
 *   always come from a successfully-constructed URL, and the digit count is
 *   only reached on a match that the NUM_VALUE alternative produced, which
 *   cannot be digit-free.
 *
 * They are left in place: they are cheap, and several would become live the
 * moment renderHtml, buildICS or the scrubber gained a second call site.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventDb, getEvent, renderEvent, sinks, redactionSinks, appearsIn,
  FUTURE_DATE, PAST_DATE, SESSION_COOKIE,
} from './_event-page-fixtures.mjs';
import { TRACKING_HEAD, TRACKING_BODY } from '../functions/events/_tracking.js';
import { scrubJoinInfo } from '../functions/events/[slug].js';
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
// A. The original label + host vocabulary: prove each still redacts
// =====================================================================

/**
 * These are the shapes the ORIGINAL nine-regex scrubber covered. They are kept
 * verbatim so the rewrite is provably a superset of what shipped, not a
 * replacement that traded one set of misses for another.
 *
 * Each case is written so no other rule can claim it:
 *   - the label cases use a host that is not a conferencing host, so the
 *     host rules cannot fire and only the label+value rule can;
 *   - the host cases carry no label, so only the host rules can fire.
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

describe('scrubJoinInfo -- shape by shape, on a page a non-member is looking at', () => {
  for (const { n, name, line, needle } of PATTERN_CASES) {
    it(`shape ${n} redacts "${name}" from every sink`, async () => {
      const rendered = await renderEvent({
        viewer: 'anonymous',
        post: { content: contentAround(line) },
      });

      assert.equal(rendered.response.status, 200);
      assert.deepEqual(
        leakingSinks(rendered, needle), [],
        `shape ${n} ("${name}") did not redact ${JSON.stringify(needle)}; `
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

  it('leaves no empty paragraph behind where a line was removed', async () => {
    // NOT a test of scrubJoinInfo's `\n{3,}` collapse, despite appearances.
    // Replacing that collapse with a no-op leaves this assertion green: the
    // extra newlines survive into summarize(), whose own
    // .map(trim).filter(Boolean) drops the blank chunk regardless. Mutation-
    // checked 2026-07-31. The collapse is inert on every input reachable here;
    // what this pins is the end-to-end outcome, which is what matters.
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\nBefore.\n\nPIN: 445566\n\nAfter.' },
    });
    assert.equal(rendered.body, '<p>Before.</p>\n<p>After.</p>',
      'the removal left an empty paragraph in the rendered body');
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
    assert.match(rendered.body ?? '', /Closing paragraph, kept\./,
      'positive control: an absence result on a page that rendered nothing proves nothing');
  });

  it('a Meet URL inside a markdown link is redacted', async () => {
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('Join [click here](https://meet.google.com/mkd-lnkk-abc) now.') },
    });
    assert.deepEqual(leakingSinks(rendered, 'mkd-lnkk-abc'), []);
    assert.deepEqual(leakingSinks(rendered, 'meet.google.com'), []);
    assert.match(rendered.body ?? '', /Closing paragraph, kept\./, 'positive control');
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
      assert.match(rendered.body ?? '', /Closing paragraph, kept\./,
        `positive control failed for: ${line}`);
    }
  });

  it('removes the URL SPAN, not the whole line it sits on', async () => {
    // This is the behaviour change the rewrite makes most visible. The old
    // `^.*meet\.google\.com.*$` deleted every line containing the host, taking
    // the author's sentence with it; a reader saw a hole where an explanation
    // should be. The span-scoped rules leave the sentence and remove the URL.
    const meet = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\nWe will use https://meet.google.com/qqq-wwww-eee for this session.' },
    });
    assert.equal(meet.body, '<p>We will use  for this session.</p>',
      'the surrounding sentence should survive with only the URL removed');
    assert.deepEqual(leakingSinks(meet, 'qqq-wwww-eee'), []);

    const tel = await renderEvent({
      viewer: 'anonymous',
      // Deliberately label-free ("use", not "call"), so the host rule is what
      // fires and the assertion is about the span, not about the label rule.
      post: { content: 'Title chunk.\n\nPlease use https://tel.meet/rrr-tttt-yyy to join by voice.' },
    });
    assert.equal(tel.body, '<p>Please use  to join by voice.</p>');
    assert.deepEqual(leakingSinks(tel, 'rrr-tttt-yyy'), []);
  });
});

// =====================================================================
// A2. The findings that WERE leaks, now closed
// =====================================================================

/**
 * Every case below used to reach all five PUBLIC sinks on a page an anonymous
 * visitor sees. Each was written as a positive "it leaked" assertion against
 * the deployed code, and each has been flipped here now that it is closed. The
 * finding id is kept so the history stays traceable, and `by` names WHICH half
 * of the label-plus-value rule earns the redaction -- because a case that is
 * redacted for the wrong reason is a case that will over-redact later.
 */
const FIXED_LEAKS = [
  // --- was class 1: labels no pattern covered ---------------------------
  { id: 'EV-L1', by: 'label "Meeting link" + a URL', line: 'Meeting link: https://video.example/leak-mtglink', needle: 'leak-mtglink' },
  { id: 'EV-L2', by: 'label "Video call" + a URL', line: 'Video call: https://video.example/leak-videocall', needle: 'leak-videocall' },
  { id: 'EV-L3', by: 'label "Zoom" + a URL', line: 'Zoom: https://zoom.example/j/leak-zoom', needle: 'leak-zoom' },
  { id: 'EV-L4', by: 'label "Teams" + a URL', line: 'Teams: https://teams.example/l/leak-teams', needle: 'leak-teams' },
  { id: 'EV-L5', by: 'label "Join here" + a URL', line: 'Join here: https://video.example/leak-joinhere', needle: 'leak-joinhere' },
  { id: 'EV-L6', by: 'label "Conference line" + 11 digits', line: 'Conference line: +1 555-020-1111', needle: '555-020-1111' },
  { id: 'EV-L7', by: 'weak label "Room" + 10 digits, over the weak floor', line: 'Room: 555 020 2222', needle: '555 020 2222' },
  { id: 'EV-L8', by: 'strong label "Passcode" + 6 digits', line: 'Passcode: 987654', needle: '987654' },
  { id: 'EV-L9', by: 'strong label "Access code" + 6 digits', line: 'Access code: 987655', needle: '987655' },
  { id: 'EV-L10', by: 'strong label "Meeting ID" + 10 digits', line: 'Meeting ID: 987 6543 210', needle: '987 6543 210' },

  // --- was class 2: the ^ anchor ---------------------------------------
  { id: 'EV-A1', by: 'the label rule is no longer line-anchored', line: 'Everything you need follows. PIN: 445566', needle: '445566' },
  { id: 'EV-A2', by: 'label "dial" + a tel: URI, mid-sentence', line: 'You can dial tel:+15550207777 from any phone.', needle: '15550207777' },

  // --- was class 3: an unlabelled number --------------------------------
  { id: 'EV-N1', by: 'weak label "Call" + 10 digits', line: 'Call 5550208888 to join by voice.', needle: '5550208888' },

  // --- was class 4: the literal host string -----------------------------
  { id: 'EV-H1', by: 'g.co/meet is a Meet room; the host rule parses the URL', line: 'Join at https://g.co/meet/rrm-weekly-call today.', needle: 'rrm-weekly-call' },
  { id: 'EV-H2', by: 'zero-width characters are stripped before matching', line: 'Join at https://meet.goo​gle.com/zwj-aaaa-bbb today.', needle: 'zwj-aaaa-bbb' },
];

describe('the leak hunt, closed: each of these used to reach every public sink', () => {
  for (const { id, by, line, needle } of FIXED_LEAKS) {
    it(`${id} is redacted (${by})`, async () => {
      const rendered = await renderEvent({
        viewer: 'anonymous',
        post: { content: contentAround(line) },
      });
      assert.equal(rendered.response.status, 200);
      assert.deepEqual(leakingSinks(rendered, needle), [],
        `${id} regressed: ${JSON.stringify(needle)} reached a public sink again`);
      // Absence proves nothing on a page that rendered nothing.
      assert.match(rendered.body ?? '', /Closing paragraph, kept\./,
        `${id}: the surrounding prose vanished, so this is over-redaction, not redaction`);
      assert.match(rendered.ogDescription ?? '', /Closing paragraph, kept\./);
    });
  }

  it('EV-W1 is redacted: a Meet URL broken across a soft line wrap loses its tail too', async () => {
    // The old rule deleted only the LINE the host appeared on, so the second
    // half of a wrapped meeting code survived on the next line. The wrap tail is
    // consumed only when the URL ended mid-token (on "-" or "/") and the next
    // line opens with a hyphenated code fragment, so an ordinary following
    // sentence is never eaten -- see the control below.
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('Join https://meet.google.com/wrp-\naaaa-bbb before 6pm.') },
    });
    assert.deepEqual(leakingSinks(rendered, 'aaaa-bbb'), [], 'EV-W1 regressed: the wrapped tail leaked');
    assert.deepEqual(leakingSinks(rendered, 'wrp-'), []);
    assert.match(rendered.body ?? '', /before 6pm\./, 'the rest of the sentence was eaten with the tail');
    assert.match(rendered.body ?? '', /Closing paragraph, kept\./);
  });

  it('the wrap tail does not swallow the next line when it is ordinary prose', async () => {
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('Join https://meet.google.com/wrap-none/\nSee you there on Tuesday.') },
    });
    assert.deepEqual(leakingSinks(rendered, 'wrap-none'), []);
    assert.match(rendered.body ?? '', /See you there on Tuesday\./,
      'the following sentence was consumed as if it were a wrapped URL tail');
  });

  it('EV-T1 is redacted: community_post.title is scrubbed, with a non-empty fallback', async () => {
    // The title column reaches <h1>, <title>, og:title, og:image:alt, JSON-LD
    // name, the .ics SUMMARY and the gcal text= parameter, for every tier.
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { title: 'Weekly Call PIN: 313131', content: 'Title chunk.\n\nBody text.' },
    });
    for (const [field, value] of [['<h1>', rendered.h1], ['og:title', rendered.ogTitle],
      ['<title>', rendered.docTitle], ['JSON-LD name', rendered.jsonLd.name]]) {
      assert.ok(!String(value ?? '').includes('313131'), `EV-T1 regressed in ${field}`);
      assert.ok(String(value ?? '').trim().length > 0, `${field} was published empty`);
    }
    // The label went with its value; the human-meaningful part of the title stayed.
    assert.equal(rendered.h1, 'Weekly Call');
    assert.ok(!rendered.html.includes('313131'), 'the credential survived somewhere else in the document');
  });

  it('EV-T1 also covers the .ics SUMMARY and the Google Calendar text= parameter', async () => {
    const db = await eventDb({
      viewer: 'anonymous',
      post: { title: 'Weekly Call PIN: 313132', content: 'Title chunk.\n\nBody text.' },
    });
    try {
      const html = await (await getEvent(db)).text();
      const s = sinks(html);
      assert.ok(!decodeURIComponent(s.gcalHref.replace(/&amp;/g, '&')).includes('313132'),
        'the credential reached the Google Calendar template');
      const ics = await (await getEvent(db, { query: '?add=ics' })).text();
      assert.ok(!ics.includes('313132'), 'the credential reached the .ics SUMMARY');
      assert.ok(ics.includes('SUMMARY:Weekly Call'), `the .ics title was emptied instead: ${/SUMMARY:.*/.exec(ics)?.[0]}`);
    } finally {
      db.close();
    }
  });

  it('EV-S1 is redacted: BOTH speaker arms are scrubbed', async () => {
    // extractSpeaker() used to run against event.content directly, and the
    // other arm of `event.speaker || extractSpeaker(content)` was the raw
    // column. Both reach the meta row, JSON-LD performer.name and the .ics.
    const fromContent = await eventDb({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\nSpeaker: Dr Ada, dial 555-020-9999\n\nBody text.' },
    });
    try {
      const s = sinks(await (await getEvent(fromContent)).text());
      assert.equal(s.speakerRow, 'Dr Ada', 'EV-S1 regressed in the meta row');
      assert.equal(s.jsonLd.performer.name, 'Dr Ada', 'EV-S1 regressed in JSON-LD performer');
      const ics = await (await getEvent(fromContent, { query: '?add=ics' })).text();
      assert.ok(!ics.includes('555-020-9999'), 'EV-S1 regressed in the .ics export');
      assert.ok(ics.includes('with Dr Ada.'), 'the speaker was emptied rather than scrubbed');
    } finally {
      fromContent.close();
    }

    const fromColumn = await eventDb({
      viewer: 'anonymous',
      post: { speaker: 'Dr Ada, PIN 445599', content: 'Title chunk.\n\nBody text.' },
    });
    try {
      const s = sinks(await (await getEvent(fromColumn)).text());
      assert.equal(s.speakerRow, 'Dr Ada', 'the speaker COLUMN arm is still unscrubbed');
      const ics = await (await getEvent(fromColumn, { query: '?add=ics' })).text();
      assert.ok(!ics.includes('445599'));
    } finally {
      fromColumn.close();
    }
  });

  it('a speaker that scrubs away entirely omits the row rather than rendering an empty one', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { speaker: 'PIN: 445588', content: 'Title chunk.\n\nBody text.' },
    });
    assert.equal(r.speakerRow, null, 'an empty "Speaker:" row was published');
    assert.equal('performer' in r.jsonLd, false);
    assert.ok(!r.html.includes('445588'));
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
// B1. The shapes that used to escape the ^ anchor
// =====================================================================

/**
 * The old patterns all began `^\s*label`. Anything before the label on the line
 * defeated them, and markdown puts something before the label constantly. Each
 * case here is the SAME credential wearing a different hat.
 */
const ANCHOR_ESCAPES = [
  { name: 'unordered list item', line: '- PIN: 445561' , needle: '445561' },
  { name: 'bold emphasis', line: '**PIN:** 445562', needle: '445562' },
  { name: 'ordered list item', line: '1. PIN: 445563', needle: '445563' },
  { name: 'blockquote', line: '> PIN: 445564', needle: '445564' },
  { name: 'nested list item', line: '  - Passcode: 445565', needle: '445565' },
  { name: 'mid-sentence', line: 'Everything you need follows. PIN: 445566 See you Tuesday.', needle: '445566' },
];

const SEPARATOR_FORMS = [
  { name: 'em dash', line: 'PIN — 445571', needle: '445571' },
  { name: 'en dash', line: 'PIN – 445572', needle: '445572' },
  { name: 'equals', line: 'Passcode = 445573', needle: '445573' },
  { name: 'full-width colon', line: 'PIN：445574', needle: '445574' },
  { name: 'pipe', line: 'Zoom | https://zoom.us/j/4455750000', needle: '4455750000' },
  { name: 'hash', line: 'Meeting ID # 445576', needle: '445576' },
  { name: 'no separator at all', line: 'Zoom https://zoom.us/j/4455770000', needle: '4455770000' },
];

describe('the ^ anchor is gone: decoration, position and separator no longer matter', () => {
  for (const { name, line, needle } of [...ANCHOR_ESCAPES, ...SEPARATOR_FORMS]) {
    it(`redacts a credential behind ${name}`, async () => {
      const rendered = await renderEvent({ viewer: 'anonymous', post: { content: contentAround(line) } });
      assert.deepEqual(leakingSinks(rendered, needle), [], `${name} still escapes redaction`);
      assert.match(rendered.body ?? '', /Closing paragraph, kept\./, 'positive control');
    });
  }

  it('redacts the multi-line form, where the label is on one line and the value on the next', async () => {
    // The old patterns deleted the LABEL line and left the credential sitting
    // alone underneath it, which is worse than not matching at all.
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('Dial-in number below.\nPIN:\n445580') },
    });
    assert.deepEqual(leakingSinks(rendered, '445580'), [],
      'the value on the following line survived the label being removed');
    assert.match(rendered.body ?? '', /Closing paragraph, kept\./);
  });

  it('redacts the multi-line form through markdown decoration on the second line', async () => {
    const rendered = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('Passcode:\n> 445581') },
    });
    assert.deepEqual(leakingSinks(rendered, '445581'), []);
    assert.match(rendered.body ?? '', /Closing paragraph, kept\./);
  });
});

// =====================================================================
// B2. Conferencing hosts, matched on the parsed host
// =====================================================================

describe('conferencing hosts are matched on the parsed hostname', () => {
  const HOSTS = [
    { name: 'zoom subdomain, with scheme', line: 'Join https://us02web.zoom.us/j/hst-8899001 now.', needle: 'hst-8899001' },
    { name: 'zoom, www form', line: 'Join www.zoom.us/j/hst-8899002 now.', needle: 'hst-8899002' },
    { name: 'Teams meetup-join', line: 'Use https://teams.microsoft.com/l/meetup-join/hst-8899003 now.', needle: 'hst-8899003' },
    { name: 'Teams consumer', line: 'Use https://teams.live.com/meet/hst-8899004 now.', needle: 'hst-8899004' },
    { name: 'Webex subdomain', line: 'Use https://rrm.webex.com/join/hst-8899005 now.', needle: 'hst-8899005' },
    { name: 'Jitsi', line: 'Use https://meet.jit.si/hst-8899006 now.', needle: 'hst-8899006' },
    { name: 'Whereby', line: 'Use https://whereby.com/hst-8899007 now.', needle: 'hst-8899007' },
    { name: 'Chime', line: 'Use https://chime.aws/hst-8899008 now.', needle: 'hst-8899008' },
    { name: 'bare host with a room path', line: 'The room is meet.google.com/hst-8899009 all week.', needle: 'hst-8899009' },
  ];

  for (const { name, line, needle } of HOSTS) {
    it(`redacts a room on ${name}`, async () => {
      const rendered = await renderEvent({ viewer: 'anonymous', post: { content: contentAround(line) } });
      assert.deepEqual(leakingSinks(rendered, needle), [], `${name} was not recognised`);
      assert.match(rendered.body ?? '', /Closing paragraph, kept\./, 'positive control');
    });
  }

  it('leaves a URL alone when it merely CONTAINS a conferencing host as a substring', async () => {
    // The host test parses the URL rather than searching the string, so a
    // hostile-looking-but-innocent path cannot be confused for a room, and an
    // RRM Academy link that happens to mention one is not deleted.
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('Read https://rrmacademy.org/library/why-meet-google-com-links-leak for context.') },
    });
    assert.match(r.body ?? '', /why-meet-google-com-links-leak/,
      'a legitimate library URL was deleted for containing a host-like path');
  });

  it('leaves an unparseable URL token alone rather than throwing on the request path', async () => {
    // The URL rule constructs a URL to read its host. A token that matches the
    // token shape but does not parse must not take the page down with it.
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('A malformed link https://[not-a-url sits here.') },
    });
    assert.equal(r.response.status, 200);
    assert.match(r.body ?? '', /not-a-url/, 'an unparseable token was silently deleted');
  });

  it('a date sitting behind a label is not mistaken for a PIN', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('The call 2026-07-31 is the one to attend.') },
    });
    assert.match(r.body ?? '', /2026-07-31/, 'a date was redacted as if it were a credential');
  });
});

// =====================================================================
// B3. Image srcs, judged on the HOST and never on the filename
// =====================================================================

describe('a markdown image whose src is the meeting room', () => {
  it('never reaches og:image, twitter:image, JSON-LD image or the rendered flyer', async () => {
    // summarize() captures firstImage during the ![...](...) strip, BEFORE the
    // scrubber runs, so an image src was a fourth channel straight to four
    // public sinks.
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { og_image_url: null, content: 'T.\n\n![join here](https://meet.google.com/img-cccc-ddd)\n\nBody.' },
    });
    assert.ok(!r.html.includes('img-cccc-ddd'), 'the Meet room was published as an image');
    assert.equal(r.flyerSrc, null);
    assert.equal(r.ogImage, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8');
    assert.equal(r.jsonLd.image, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8');
  });

  it('falls through to the NEXT image rather than losing the flyer entirely', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: {
        og_image_url: null,
        content: 'T.\n\n![room](https://meet.google.com/img-eeee-fff) ![flyer](https://cdn.example/endo-call-2026.jpg)\n\nBody.',
      },
    });
    assert.equal(r.flyerSrc, 'https://cdn.example/endo-call-2026.jpg');
    assert.ok(!r.html.includes('img-eeee-fff'));
  });

  it('a MEMBER does not get the meeting room served as an <img> either', async () => {
    // The flyer and og:image are built from the scrubbed summary for every
    // tier. Members reach the room through the Join Call button.
    const r = await renderEvent({
      viewer: 'member',
      post: { og_image_url: 'https://meet.google.com/img-gggg-hhh', content: 'T.\n\nB.' },
    });
    assert.ok(!r.html.includes('img-gggg-hhh'));
  });

  it('an image src that does not parse is kept, not dropped', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { og_image_url: null, content: 'T.\n\n![f](https://[not-a-url)\n\nBody.' },
    });
    assert.equal(r.response.status, 200);
    assert.match(r.flyerSrc ?? '', /not-a-url/, 'an unparseable src was treated as a credential');
  });
});

// =====================================================================
// B4. Residual leaks, kept honest
// =====================================================================

/**
 * A denylist over free text is best-effort by construction. These cases still
 * reach every public sink, and each is here because closing it would have cost
 * more clinical prose than it saved -- which is precisely the trade the first
 * attempt at this fix got wrong.
 *
 * These assertions are deliberately positive ("it leaked"). If one goes red,
 * the residual is closed: flip it into the block above and say which rule did
 * it. Do NOT close one by loosening the label-plus-value rule.
 */
const RESIDUAL_LEAKS = [
  {
    id: 'EV-R1',
    why: 'a blank line between the label and the value',
    cost: 'the separator would have to span paragraph breaks, which lets a label '
      + 'at the end of one paragraph claim a number at the start of the next',
    line: 'PIN:\n\n445590',
    needle: '445590',
  },
  {
    id: 'EV-R2',
    why: 'a conferencing host outside CONFERENCING_HOSTS',
    cost: 'the alternative is redacting every URL on the page, which deletes the '
      + 'library and registration links these posts exist to carry',
    line: 'Join at https://gotomeeting.example/j/res-abc-123 today.',
    needle: 'res-abc-123',
  },
  {
    id: 'EV-R3',
    why: 'a label word outside the vocabulary',
    cost: 'the vocabulary can only grow by guessing, and every ordinary English '
      + 'word added to it is a new way to delete a talk title',
    line: 'Bridge: https://video.example/res-xyz-789',
    needle: 'res-xyz-789',
  },
  {
    id: 'EV-R4',
    why: 'a bare digit run with no label at all',
    cost: 'redacting unlabelled digit runs would eat ORCIDs (0000-0003-3706-3112), '
      + 'PMIDs, NCT numbers and EINs, all of which are ordinary RRM Academy copy',
    line: 'The number is 5550209999.',
    needle: '5550209999',
  },
  {
    id: 'EV-R5',
    why: 'a weak label with a digit run below the weak floor',
    cost: 'lowering the weak floor redacts doses, cycle days and room numbers; '
      + '"Room: 4821" is indistinguishable from "Room 4821 on the second floor"',
    line: 'Room: 4821',
    needle: '4821',
  },
  {
    id: 'EV-R6',
    why: 'a credential spelled out in words',
    cost: 'no denylist over free text can reach this, and nothing short of not '
      + 'putting credentials in free text will',
    line: 'The pin is four four five five nine one.',
    needle: 'four four five five nine one',
  },
];

describe('residual leaks -- documented, not silently accepted', () => {
  for (const { id, why, cost, line, needle } of RESIDUAL_LEAKS) {
    it(`LEAKS ${id}: ${why}`, async () => {
      const rendered = await renderEvent({ viewer: 'anonymous', post: { content: contentAround(line) } });
      assert.deepEqual(
        leakingSinks(rendered, needle),
        ['rendered body', 'og:description', 'twitter:description', 'meta description', 'schema.org JSON-LD'],
        `${id} no longer reaches every public sink. If ${JSON.stringify(needle)} is now redacted, `
        + `the residual is CLOSED: move this case into the block above. It was left open because: ${cost}.`
      );
    });
  }
});

// =====================================================================
// B5. Cost: the scrubber runs on an unauthenticated, crawled page
// =====================================================================

describe('scrubJoinInfo is linear in input length', () => {
  /**
   * The previous attempt at this fix was rejected for being super-linear on
   * ORDINARY PROSE containing no credential, no label and no host. /events/
   * <slug> is anonymous-reachable and crawled, so a super-linear matcher is a
   * denial-of-service primitive any visitor can aim at it.
   *
   * The ceiling below is deliberately loose -- measured cost is ~4-14 ns/char,
   * so 100k characters lands around 0.4-1.5 ms and this allows 400x that. It is
   * not a performance benchmark; it is a shape guard. Anything quadratic on
   * 100k characters takes seconds to minutes and cannot squeeze under it, and
   * nothing linear can approach it even on a loaded CI box.
   */
  const CEILING_MS = 400;

  const SHAPES = {
    'ordinary prose': 'Restorative reproductive medicine treats the underlying cause rather than bypassing it. ',
    'label words with no values': 'room call zoom teams dial phone meet tel pin webex telephone ',
    'digit runs with no labels': '1234 5678 9012 3456 7890 ',
    'a label followed by separators': 'PIN:::::::::::::::::::::::::::::::::: ',
    'every line a credential': 'PIN: 998877665\nMeet link: https://meet.google.com/aaa-bbbb-ccc\nDial-in: +1 555-010-1111\n',
  };

  function build(unit, n) {
    let s = '';
    while (s.length < n) s += unit;
    return s.slice(0, n);
  }

  for (const [name, unit] of Object.entries(SHAPES)) {
    it(`stays flat per character on ${name}`, () => {
      const timings = [1000, 10000, 100000].map((n) => {
        const input = build(unit, n);
        scrubJoinInfo(input); // warm
        const t0 = process.hrtime.bigint();
        scrubJoinInfo(input);
        return { n, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
      });
      for (const { n, ms } of timings) {
        assert.ok(ms < CEILING_MS,
          `${name} at ${n} chars took ${ms.toFixed(1)}ms, over the ${CEILING_MS}ms shape ceiling; `
          + 'the matcher has gone super-linear on a public, crawled endpoint');
      }
    });
  }

  it('a single adversarial span does not blow up either', () => {
    // Each of these is one match attempt over a 100k-character run: a greedy
    // class with nothing after it, the classic quadratic backtracking shape if
    // the value pattern were written with a second quantifier behind it.
    const ADVERSARIAL = {
      'one label, one 100k digit run': 'PIN: ' + '1'.repeat(100000),
      'one label, one 100k space run': 'PIN:' + ' '.repeat(100000) + 'x',
      'one 100k URL token': 'Join https://meet.google.com/' + 'a'.repeat(100000),
      'one 100k unbroken word': 'a'.repeat(100000),
      'one 100k dotted host-like run': 'a.'.repeat(50000),
    };
    for (const [name, input] of Object.entries(ADVERSARIAL)) {
      scrubJoinInfo(input); // warm
      const t0 = process.hrtime.bigint();
      scrubJoinInfo(input);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      assert.ok(ms < CEILING_MS, `${name} took ${ms.toFixed(1)}ms, over the ${CEILING_MS}ms shape ceiling`);
    }
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
      // Positive control. Without it this case passes on a page that rendered
      // no prose at all, which is how an absence assertion goes vacuous.
      assert.match(r.jsonLd.description, /What we will cover\./,
        'the post content never reached the JSON-LD, so "no credential in it" proves nothing');
      // location.url is the public landing page, never the Meet room.
      assert.equal(r.jsonLd.location['@type'], 'VirtualLocation');
      assert.equal(r.jsonLd.location.url, 'https://rrmacademy.org/events/endo-excision-call');
    });

    it(`the rendered body carries no joining info for a ${viewer} visitor`, async () => {
      const r = await renderEvent({ viewer, post: POST });
      for (const needle of ['snk-aaaa-bbb', 'meet.google.com', '555-030-1111', '707070']) {
        assert.ok(!appearsIn(r.body ?? '', needle), `body leaked ${needle}`);
      }
      // Positive control, same reason as the JSON-LD case above.
      assert.match(r.body ?? '', /What we will cover\./,
        'the body rendered nothing, so "no credential in the body" proves nothing');
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

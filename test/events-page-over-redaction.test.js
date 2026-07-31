/**
 * functions/events/[slug].js -- the ANTI-OVER-REDACTION fixture set.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Three successive attempts to widen the event-page redaction over free text
 * were rejected in review, and not one of them was rejected for missing a
 * credential. Every rejection was for the same defect: OVER-REDACTION, on fields
 * that are structurally required and whose destruction is silent. The page still
 * returns 200, the <h1> is simply wrong, and nothing anywhere reports it.
 *
 *   attempt 1  bare words as labels -- "room", "zoom", "teams", "call", "dial",
 *              "phone", "tel" -- in a reproductive-medicine library where those
 *              words are everywhere. "Teams-Based Care in RRM", a clinician talk
 *              title, scrubbed to the empty string. (Plus a ReDoS.)
 *   attempt 2  a bare four-digit year behind a label. "Video Call 2026" scrubbed
 *              to the empty string, because a four-digit PIN and a four-digit
 *              year are the same shape.
 *   attempt 3  "Video call 2026-07-31 18:00 Eastern" scrubbed to ":00 Eastern";
 *              "Room 1201-1204 fellowship intensive" scrubbed to "fellowship
 *              intensive"; hyphenated clinical English shaped 3-4-3 deleted
 *              behind a conferencing label.
 *
 * Each round closed its named cases and produced new ones, because natural
 * language keeps generating shapes that look like credentials.
 *
 * SO THE SCOPE THAT SHIPPED MATCHES HOSTS AND URLS, NEVER PROSE
 * ------------------------------------------------------------
 * JOIN_INFO_PATTERNS is byte-for-byte what has been in production. What changed
 * is that two previously unscrubbed fields (title, speaker) now run through
 * those same unmodified patterns, that an <img> src is judged on its parsed
 * HOSTNAME, and that a hostname is normalised once before any comparison. A
 * hostname is not English, so that half has no over-redaction failure mode by
 * construction.
 *
 * THE CASUALTY LIST IS THE STANDING PROOF
 * ---------------------------------------
 * Every string the three rejected rounds destroyed is a fixture below. They are
 * not illustrations. They are the evidence that this scope is safe, and a
 * redaction change that turns any of them red is not a tuning problem -- it is
 * the same defect that got the last three attempts rejected.
 *
 * Read together with its opposite number:
 *   events-page-redaction.test.js  -- a credential must not survive.
 *   THIS FILE                      -- prose must not die, and nothing required
 *                                     may be emptied as a RESULT of scrubbing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderEvent, eventDb, getEvent, sinks } from './_event-page-fixtures.mjs';

// =====================================================================
// A. The verified casualties of the three rejected rounds
// =====================================================================

/**
 * Each entry is a string a previous attempt DESTROYED, named with the round that
 * destroyed it and what it became. `keep` must survive VERBATIM.
 *
 * They are asserted in the title sinks and the body sinks both, because the
 * title is the one that broke: an emptied body is visible on the page, an
 * emptied title publishes a wrong <h1> and a wrong link preview silently.
 */
const CASUALTIES = [
  {
    id: 'CAS-1', round: 1, was: 'scrubbed to the empty string as a title',
    text: 'Teams-Based Care in RRM',
  },
  {
    id: 'CAS-2', round: 2, was: 'scrubbed to the empty string as a title',
    text: 'Video Call 2026',
  },
  {
    id: 'CAS-3', round: 3, was: 'scrubbed to ":00 Eastern"',
    text: 'Video call 2026-07-31 18:00 Eastern',
  },
  {
    id: 'CAS-4', round: 3, was: 'scrubbed to "fellowship intensive"',
    text: 'Room 1201-1204 fellowship intensive',
  },
  {
    id: 'CAS-5', round: 3, was: 'deleted behind a conferencing label as a 3-4-3 room code',
    text: 'follicle-stimulating hormone',
  },
  {
    id: 'CAS-6', round: 3, was: 'deleted behind a conferencing label as a 3-4-3 room code',
    text: 'two-week-old',
  },
];

describe('the casualties of the three rejected rounds must all survive', () => {
  for (const { id, round, was, text } of CASUALTIES) {
    it(`${id}: attempt ${round} ${was} -- "${text}" survives every title sink`, async () => {
      const r = await renderEvent({
        viewer: 'anonymous',
        post: { title: text, content: 'Fallback Chunk Title\n\nBody prose kept.' },
      });
      assert.equal(r.response.status, 200);
      assert.equal(r.h1, text, `${id} was rewritten in <h1>`);
      assert.equal(r.ogTitle, `${text} | Save the Uterus Club`, `${id} was rewritten in og:title`);
      assert.equal(r.docTitle, `${text} | Save the Uterus Club`, `${id} was rewritten in <title>`);
      assert.equal(r.jsonLd?.name, text, `${id} was rewritten in the JSON-LD name`);
      const alt = /<meta property="og:image:alt" content="([^"]*)">/.exec(r.html)?.[1] ?? '';
      assert.equal(alt, text, `${id} was rewritten in og:image:alt`);
    });

    it(`${id}: "${text}" survives every body sink`, async () => {
      const r = await renderEvent({
        viewer: 'anonymous',
        post: { content: `Title chunk.\n\n${text} is discussed in the second half.` },
      });
      assert.ok((r.body ?? '').includes(text), `${id} was over-redacted out of the rendered body`);
      assert.ok((r.ogDescription ?? '').includes(text), `${id} was over-redacted out of og:description`);
      assert.ok((r.twitterDescription ?? '').includes(text), `${id} was over-redacted out of twitter:description`);
      assert.ok((r.metaDescription ?? '').includes(text), `${id} was over-redacted out of the meta description`);
      assert.ok(String(r.jsonLd?.description ?? '').includes(text), `${id} was over-redacted out of the JSON-LD description`);
    });

    it(`${id}: "${text}" survives the speaker channel and the .ics`, async () => {
      const db = await eventDb({ viewer: 'anonymous', post: { speaker: text, content: 'T.\n\nB.' } });
      try {
        const s = sinks(await (await getEvent(db)).text());
        assert.equal(s.speakerRow, text, `${id} was over-redacted out of the speaker meta row`);
        assert.equal(s.jsonLd.performer.name, text, `${id} was over-redacted out of JSON-LD performer.name`);
        const ics = await (await getEvent(db, { query: '?add=ics' })).text();
        assert.ok(ics.includes(text), `${id} was over-redacted out of the .ics DESCRIPTION`);
      } finally { db.close(); }
    });
  }

  it('CAS-7: "endo-call-2026.jpg" is a flyer, not a credential -- the filename is never consulted', async () => {
    // Attempt 3 matched conferencing vocabulary anywhere in the URL STRING, so a
    // legitimate flyer whose filename contains the word "call" was dropped and
    // the page published the branded fallback card instead. Only the parsed
    // HOSTNAME may decide.
    const src = 'https://cdn.example/endo-call-2026.jpg';
    const fromColumn = await renderEvent({ viewer: 'anonymous', post: { og_image_url: src, content: 'T.\n\nB.' } });
    assert.equal(fromColumn.flyerSrc, src, 'the flyer was dropped from the rendered <img>');
    assert.equal(fromColumn.ogImage, src, 'the flyer was dropped from og:image');
    assert.equal(fromColumn.jsonLd.image, src, 'the flyer was dropped from the JSON-LD image');

    const fromContent = await renderEvent({ viewer: 'anonymous', post: { og_image_url: null, content: `T.\n\n![flyer](${src})\n\nB.` } });
    assert.equal(fromContent.flyerSrc, src, 'the markdown flyer was dropped');
    assert.equal(fromContent.ogImage, src);
  });
});

// =====================================================================
// B. A label alone is not a credential
// =====================================================================

/**
 * Sentences that contain a redaction LABEL but no credential value, each one a
 * phrase that plausibly appears in RRM Academy copy. `keep` must survive
 * verbatim in the rendered body and in og:description.
 *
 * These are the shapes attempt 1 destroyed wholesale. They pass today because
 * the shipped patterns require a label to be at the START of a line AND followed
 * by a colon; the point of pinning them is that the next widening cannot quietly
 * drop either requirement.
 */
const MUST_NOT_REDACT = [
  { id: 'MN-1', text: 'Teams-Based Care in RRM is the model we are describing.', keep: 'Teams-Based Care in RRM' },
  { id: 'MN-2', text: 'Zoom fatigue in telehealth is a real barrier for patients.', keep: 'Zoom fatigue in telehealth' },
  { id: 'MN-3', text: 'If the chart looks unclear we will call you before the next cycle.', keep: 'we will call you' },
  { id: 'MN-4', text: 'Progesterone requires room temperature storage before reconstitution.', keep: 'room temperature storage' },
  { id: 'MN-5', text: 'We would call a 10-day luteal phase short but not deficient.', keep: 'a 10-day luteal phase' },
  { id: 'MN-6', text: 'The starting dose discussed on the call is 200 mg daily.', keep: '200 mg' },
  { id: 'MN-7', text: 'Registration closes 2026-07-31 for this cohort.', keep: '2026-07-31' },
  { id: 'MN-8', text: 'Come meet the speaker afterwards in the hallway.', keep: 'meet the speaker' },
  { id: 'MN-9', text: 'Conference proceedings from 2026 will be posted later.', keep: 'Conference proceedings from 2026' },
  { id: 'MN-10', text: 'Phone consultations are available for established patients.', keep: 'Phone consultations are available' },
  { id: 'MN-11', text: 'Dial down the inflammatory load before attempting surgery.', keep: 'Dial down the inflammatory load' },
  { id: 'MN-12', text: 'Room 12 on the second floor is where the clinic meets.', keep: 'Room 12 on the second floor' },
  { id: 'MN-13', text: 'We will pin the reading list to the top of the channel.', keep: 'pin the reading list' },
  { id: 'MN-14', text: 'Teams of two will review each chart together.', keep: 'Teams of two' },
  { id: 'MN-15', text: 'The meeting link will be emailed to members only.', keep: 'The meeting link will be emailed' },
  { id: 'MN-16', text: 'Access code words like these are discussed, never printed.', keep: 'Access code words like these' },
  { id: 'MN-17', text: 'A video call is not a substitute for an exam.', keep: 'A video call is not a substitute' },
  { id: 'MN-18', text: 'Cycle day 3 labs, day 21 progesterone, 5 mg twice daily.', keep: 'day 21 progesterone, 5 mg twice daily' },
  { id: 'MN-19', text: 'Video Call 2026', keep: 'Video Call 2026' },
  { id: 'MN-20', text: 'Video Call 2026-2027 spans two academic years.', keep: 'Video Call 2026-2027' },
  { id: 'MN-21', text: 'Join Call 1999 was the first of the retrospective series.', keep: 'Join Call 1999' },
  { id: 'MN-22', text: 'Serum follicle-stimulating hormone is drawn on cycle day 3.', keep: 'follicle-stimulating hormone' },
  { id: 'MN-23', text: 'The two-week-old sample was re-run before the chart review.', keep: 'two-week-old' },
  { id: 'MN-24', text: 'Add-back therapy with norethindrone acetate is discussed.', keep: 'Add-back therapy' },
  { id: 'MN-25', text: 'Room 1201-1204 fellowship intensive runs all week.', keep: 'Room 1201-1204 fellowship intensive' },
  { id: 'MN-26', text: 'Video call 2026-07-31 18:00 Eastern, recording to follow.', keep: 'Video call 2026-07-31 18:00 Eastern' },
];

describe('the scrubber must not eat clinical prose (a label alone is not a credential)', () => {
  for (const { id, text, keep } of MUST_NOT_REDACT) {
    it(`${id}: keeps "${keep}" in the body sinks`, async () => {
      const r = await renderEvent({ viewer: 'anonymous', post: { content: `Title chunk.\n\n${text}` } });
      assert.equal(r.response.status, 200);
      assert.ok((r.body ?? '').includes(keep),
        `${id} was over-redacted out of the rendered body.\n  wanted: ${JSON.stringify(keep)}\n  body:   ${JSON.stringify(r.body)}`);
      assert.ok((r.ogDescription ?? '').includes(keep),
        `${id} was over-redacted out of og:description.\n  og:     ${JSON.stringify(r.ogDescription)}`);
      assert.ok(String(r.jsonLd?.description ?? '').includes(keep),
        `${id} was over-redacted out of the JSON-LD description`);
    });

    it(`${id}: an innocent title survives into <h1>, <title>, og:title and JSON-LD`, async () => {
      // The TITLE is the field that broke in every rejected round: it is
      // required, and an emptied one silently publishes a value from elsewhere.
      const r = await renderEvent({ viewer: 'anonymous', post: { title: text, content: 'T.\n\nB.' } });
      assert.ok((r.h1 ?? '').includes(keep), `${id} was over-redacted out of <h1>: ${JSON.stringify(r.h1)}`);
      assert.ok((r.docTitle ?? '').includes(keep), `${id} was over-redacted out of <title>`);
      assert.ok((r.ogTitle ?? '').includes(keep), `${id} was over-redacted out of og:title`);
      assert.ok(String(r.jsonLd?.name ?? '').includes(keep), `${id} was over-redacted out of the JSON-LD name`);
    });
  }
});

// =====================================================================
// C. The three newly-scrubbed channels must survive an innocent value
// =====================================================================

describe('the newly-scrubbed channels keep what is innocent', () => {
  it('an ordinary speaker name survives the column arm', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { speaker: 'Dr Naomi Whittaker, MD', content: 'T.\n\nB.' },
    });
    assert.equal(r.speakerRow, 'Dr Naomi Whittaker, MD');
    assert.equal(r.jsonLd.performer.name, 'Dr Naomi Whittaker, MD');
  });

  it('an ordinary speaker name survives the content arm', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { speaker: null, content: 'T.\n\nSpeaker: Dr Phil Boyle, teams lead\n\nB.' },
    });
    assert.equal(r.speakerRow, 'Dr Phil Boyle, teams lead');
  });

  /**
   * A FILENAME IS NOT PROSE. Matching a conferencing word anywhere in the URL
   * string is what dropped legitimate flyers in attempt 3. Only the parsed
   * hostname may decide, so every one of these carries a loaded word in its path
   * and must survive from BOTH sources (the og_image_url column and a markdown
   * image in the content).
   */
  const INNOCENT_IMAGES = [
    'https://cdn.example/endo-call-2026.jpg',
    'https://cdn.example/zoom-in-on-the-ultrasound.png',
    'https://cdn.example/teams/room-101/pin-board.webp',
    'https://cdn.example/dial-in-to-your-cycle.jpg',
    'https://cdn.example/meet.google.com-explainer.png',
    '/images/meet-the-team-2026.png',
    'images/tel-meet-diagram.png',
  ];

  for (const src of INNOCENT_IMAGES) {
    it(`keeps the flyer at ${src}`, async () => {
      const fromColumn = await renderEvent({ viewer: 'anonymous', post: { og_image_url: src, content: 'T.\n\nB.' } });
      assert.ok(fromColumn.flyerSrc, `og_image_url ${src} was dropped from the rendered flyer`);
      assert.ok(fromColumn.ogImage.endsWith(src.replace(/^\//, '')), `og:image lost ${src}`);
      assert.ok(fromColumn.jsonLd.image.endsWith(src.replace(/^\//, '')), `the JSON-LD image lost ${src}`);

      const fromContent = await renderEvent({
        viewer: 'anonymous',
        post: { og_image_url: null, content: `T.\n\n![flyer](${src})\n\nB.` },
      });
      assert.ok(fromContent.flyerSrc, `the markdown image ${src} was dropped from the rendered flyer`);
    });
  }

  it('a host that merely ENDS in a conferencing name is not a conferencing host', async () => {
    // endsWith('.' + known), not endsWith(known): "notzoom.us" and
    // "evilzoom.us" are different registrable domains from "zoom.us", and an
    // image on either is somebody's CDN, not a meeting room.
    for (const src of ['https://notzoom.us/flyer.png', 'https://fakewebex.com/flyer.png', 'https://xmeet.google.com.evil.test/f.png']) {
      const r = await renderEvent({ viewer: 'anonymous', post: { og_image_url: src, content: 'T.\n\nB.' } });
      assert.equal(r.flyerSrc, src, `${src} was wrongly treated as a meeting room`);
    }
  });

  it('g.co outside its /meet space is an ordinary shortener, not a room', async () => {
    for (const src of ['https://g.co/doodles/flyer.png', 'https://g.co/meetings-explained.png', 'https://www.g.co/photos/f.png']) {
      const r = await renderEvent({ viewer: 'anonymous', post: { og_image_url: src, content: 'T.\n\nB.' } });
      assert.equal(r.flyerSrc, src, `${src} was wrongly treated as a meeting room`);
    }
  });

  it('g.co INSIDE its /meet space is a room, with or without www and with or without a trailing path', async () => {
    // The narrowing exception, pinned in the direction that matters: consulting
    // the path here must not be so narrow that it stops catching the room.
    for (const src of ['https://g.co/meet/gco-aaaa-bbb', 'https://www.g.co/meet/gco-cccc-ddd', 'https://g.co/meet']) {
      const r = await renderEvent({ viewer: 'anonymous', post: { og_image_url: src, content: 'T.\n\nB.' } });
      assert.equal(r.flyerSrc, null, `${src} was published as a flyer`);
      assert.equal(r.ogImage, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8');
    }
  });

  it('a data: URI has no host at all, and a hostless URL is not a conferencing host', async () => {
    // URL.hostname is the empty string for a non-special scheme. The host
    // comparison must treat that as "not a room" rather than throwing or
    // matching, and an inline image is a legitimate thing for an author to paste.
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    const r = await renderEvent({ viewer: 'anonymous', post: { og_image_url: src, content: 'T.\n\nB.' } });
    assert.equal(r.response.status, 200);
    // Not vetoed as a credential: the src survives into the flyer. What abs()
    // then does to a non-http scheme is pre-existing behaviour outside this
    // change, so this asserts the veto decision and not the absolutiser.
    assert.ok((r.flyerSrc ?? '').includes('iVBORw0KGgo='), 'the inline data: image was vetoed as a meeting room');
    assert.ok((r.ogImage ?? '').length > 0, 'og:image was published empty');
  });

  it('a src that does not PARSE is kept, because an unparseable URL is not a room anyone can join', async () => {
    // Failing closed here would drop an author's image on the strength of a
    // typo, which is the over-redaction failure mode this whole file exists to
    // prevent. Both sources, and the page still renders it escaped and inert.
    for (const src of ['https://exa mple/flyer.png', 'http://[/flyer.png']) {
      const fromColumn = await renderEvent({ viewer: 'anonymous', post: { og_image_url: src, content: 'T.\n\nB.' } });
      assert.equal(fromColumn.response.status, 200);
      assert.equal(fromColumn.flyerSrc, src, `${src} was dropped from the rendered flyer`);
      assert.ok((fromColumn.ogImage ?? '').length > 0, 'og:image was published empty');

      const fromContent = await renderEvent({ viewer: 'anonymous', post: { og_image_url: null, content: `T.\n\n![f](${src})\n\nB.` } });
      assert.equal(fromContent.flyerSrc, src, `${src} was dropped from the markdown flyer`);
    }
  });
});

// =====================================================================
// D. The image leak, closed on all four sinks
// =====================================================================

describe('a markdown IMAGE whose src is the meeting room reaches none of its four sinks', () => {
  const IMAGE_SINKS = (r) => [
    ['og:image', r.ogImage],
    ['twitter:image', /<meta name="twitter:image" content="([^"]*)">/.exec(r.html)?.[1]],
    ['JSON-LD image', r.jsonLd?.image],
    ['rendered flyer src', r.flyerSrc],
  ];

  it('EV-X0 is CLOSED: the room is in none of og:image, twitter:image, JSON-LD image or the flyer', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\n![Join the call](https://meet.google.com/img-aaaa-bbb)\n\nSee you there.' },
    });
    assert.equal(r.response.status, 200);
    for (const [name, value] of IMAGE_SINKS(r)) {
      assert.ok(!String(value ?? '').includes('img-aaaa-bbb'), `the Meet room is still in ${name}: ${JSON.stringify(value)}`);
    }
    assert.ok(!r.html.includes('img-aaaa-bbb'), 'the Meet room reached the document somewhere');
    assert.ok(!r.html.includes('meet.google.com'), 'the Meet host reached the document somewhere');
    // ...and the page is still a page: the fallback is the branded card, and the
    // prose around the image is untouched.
    assert.equal(r.ogImage, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8');
    assert.equal(r.flyerSrc, null, 'no flyer element should be emitted rather than an empty one');
    assert.match(r.body ?? '', /See you there\./);
  });

  it('the og_image_url COLUMN is closed on the same four sinks', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { og_image_url: 'https://meet.google.com/col-aaaa-bbb', content: 'Title chunk.\n\nSee you there.' },
    });
    for (const [name, value] of IMAGE_SINKS(r)) {
      assert.ok(!String(value ?? '').includes('col-aaaa-bbb'), `the Meet room is still in ${name}`);
    }
    assert.equal(r.ogImage, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8');
    assert.equal(r.flyerSrc, null);
  });

  it('a trailing root dot does not defeat the host comparison, on either source', async () => {
    // "meet.google.com." and "meet.google.com" address the same host and a
    // browser joins the room through either. URL.hostname keeps the dot, so
    // before normalizeHost() it matched neither `===` nor endsWith('.' + known).
    const fromColumn = await renderEvent({
      viewer: 'anonymous',
      post: { og_image_url: 'https://meet.google.com./dot-aaaa-bbb', content: 'T.\n\nB.' },
    });
    assert.ok(!fromColumn.html.includes('dot-aaaa-bbb'), 'a trailing root dot published the room from the column');
    assert.equal(fromColumn.ogImage, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8');

    const fromContent = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'T.\n\n![join](https://ZOOM.US./j/dot-cccc-ddd)\n\nTail.' },
    });
    assert.ok(!fromContent.html.includes('dot-cccc-ddd'), 'a trailing root dot published the room from a markdown image');
    assert.match(fromContent.body ?? '', /Tail\./);
  });

  it('TWO or more trailing dots are left alone, because an empty DNS label does not resolve', async () => {
    // Exactly one dot is stripped. Collapsing a run of them would be inventing a
    // host the author did not write, and "meet.google.com../x" is not a name any
    // resolver will answer, so it is not a working credential.
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { og_image_url: 'https://meet.google.com../two-dots.png', content: 'T.\n\nB.' },
    });
    assert.equal(r.flyerSrc, 'https://meet.google.com../two-dots.png');
  });

  it('a SECOND, legitimate image is promoted when the first one is the room', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'T.\n\n![room](https://meet.google.com/sec-aaaa-bbb) ![flyer](https://cdn.example/real-flyer.png)\n\nB.' },
    });
    assert.equal(r.flyerSrc, 'https://cdn.example/real-flyer.png');
    assert.equal(r.ogImage, 'https://cdn.example/real-flyer.png');
    assert.ok(!r.html.includes('sec-aaaa-bbb'));
  });

  it('a MEMBER page does not publish the room as its og:image either', async () => {
    // og:image, twitter:image and the JSON-LD are shared, cacheable surfaces:
    // they are the same for every tier by design, so the member render must not
    // reintroduce the room there.
    const r = await renderEvent({
      viewer: 'member',
      post: { content: 'Title chunk.\n\n![Join](https://meet.google.com/mbr-aaaa-bbb)\n\nSee you there.' },
    });
    assert.ok(!(r.ogImage ?? '').includes('mbr-aaaa-bbb'));
    assert.ok(!String(r.jsonLd?.image ?? '').includes('mbr-aaaa-bbb'));
    assert.equal(r.flyerSrc, null);
  });
});

// =====================================================================
// E. Nothing structurally required may be emptied by scrubbing
// =====================================================================

/**
 * The title, the description and the image are structurally required: the page
 * emits an <h1>, an og:title, a meta description and an og:image whatever the
 * row contains. Scrubbing can remove all of a field, so each ends in a fallback
 * chain that cannot return blank.
 *
 * WHY THE LAST RESORT IS A CONSTANT AND NOT THE UNSCRUBBED ORIGINAL
 * ----------------------------------------------------------------
 * "Fall back to what was there before scrubbing" is the obvious guard and it is
 * the wrong one, because of what it falls back TO. There is no input on which
 * scrubbing empties one of these fields innocently: reaching blank requires the
 * whole field to have matched a credential rule, so the unscrubbed original IS
 * the credential. Every case below is therefore asserted twice -- non-empty, AND
 * the credential absent -- so a future change that satisfies "never empty" by
 * republishing the original turns this file red rather than green.
 */
describe('nothing required may be emptied: the direct attack on all three fields', () => {
  const ALL_CREDENTIAL_CONTENT =
    'PIN: 998877665\n\nMeet link: https://meet.google.com/emp-aaaa-bbb\n\nDial-in: +1 555-060-1111';
  const CREDENTIAL_NEEDLES = [
    '998877665', 'emp-aaaa-bbb', 'meet.google.com', '555-060-1111', 'emp-cccc-ddd', '313131',
  ];

  /** Every sink that is structurally required to carry something. */
  function requiredSinks(r) {
    return [
      ['<h1>', r.h1],
      ['<title>', r.docTitle],
      ['og:title', r.ogTitle],
      ['og:image:alt', /<meta property="og:image:alt" content="([^"]*)">/.exec(r.html)?.[1]],
      ['JSON-LD name', r.jsonLd?.name],
      ['meta description', r.metaDescription],
      ['og:description', r.ogDescription],
      ['twitter:description', r.twitterDescription],
      ['JSON-LD description', r.jsonLd?.description],
      ['og:image', r.ogImage],
      ['twitter:image', /<meta name="twitter:image" content="([^"]*)">/.exec(r.html)?.[1]],
      ['JSON-LD image', r.jsonLd?.image],
      ['canonical', r.canonical],
      ['primary CTA href', r.ctaPrimary],
      ['primary CTA label', r.ctaPrimaryLabel],
    ];
  }

  function assertNothingEmptyAndNothingLeaked(r, label) {
    assert.equal(r.response.status, 200, `${label} did not render`);
    for (const [field, value] of requiredSinks(r)) {
      assert.ok(value != null && String(value).trim().length > 0,
        `${label}: ${field} was published empty (${JSON.stringify(value)})`);
    }
    for (const needle of CREDENTIAL_NEEDLES) {
      assert.ok(!r.html.includes(needle),
        `${label}: the guard filled ${JSON.stringify(needle)} back in; a non-empty fallback must not be the credential`);
    }
  }

  /** Titles that really do scrub to nothing under the SHIPPED, unmodified patterns. */
  const EMPTYING_TITLES = [
    'PIN: 313131',
    'Dial-in: +1 555-060-1111',
    'Phone: +1 555-060-1111',
    'Meet link: https://meet.google.com/emp-aaaa-bbb',
    'https://meet.google.com/emp-aaaa-bbb',
    '- Meet link: https://meet.google.com/emp-aaaa-bbb',
    'Join the call: https://meet.google.com/emp-aaaa-bbb',
    '   ',
    '',
  ];

  it('TITLE: every title that scrubs to nothing still publishes a heading, from a safe source', async () => {
    for (const title of EMPTYING_TITLES) {
      const r = await renderEvent({
        viewer: 'anonymous',
        post: { title, content: 'Fallback Chunk Title\n\nBody prose kept.' },
      });
      assertNothingEmptyAndNothingLeaked(r, `title ${JSON.stringify(title)}`);
      assert.equal(r.h1, 'Fallback Chunk Title',
        `title ${JSON.stringify(title)} did not fall through to the scrubbed first content chunk`);
    }
  });

  it('TITLE: with no safe second source either, it lands on the constant and never on the original', async () => {
    for (const title of EMPTYING_TITLES) {
      const r = await renderEvent({ viewer: 'anonymous', post: { title, content: ALL_CREDENTIAL_CONTENT } });
      assertNothingEmptyAndNothingLeaked(r, `title ${JSON.stringify(title)} with no safe chunk`);
      assert.equal(r.h1, 'Save the Uterus Club Event');
    }
  });

  it('DESCRIPTION: content that scrubs to nothing still publishes a description', async () => {
    for (const content of [ALL_CREDENTIAL_CONTENT, '   ', '\n\n\n', null]) {
      const r = await renderEvent({ viewer: 'anonymous', post: { title: 'A Real Title', content } });
      assertNothingEmptyAndNothingLeaked(r, `content ${JSON.stringify(content)}`);
      assert.equal(r.ogDescription, 'Live members-only call from Save the Uterus Club.');
      assert.equal(r.metaDescription, 'Live members-only call from Save the Uterus Club.');
      assert.equal(r.twitterDescription, 'Live members-only call from Save the Uterus Club.');
      assert.equal(r.jsonLd.description, 'Live members-only call from Save the Uterus Club.');
      assert.equal(r.h1, 'A Real Title');
    }
  });

  it('IMAGE: a src that is the room, blank, or whitespace still publishes an og:image', async () => {
    for (const og_image_url of ['https://meet.google.com/emp-cccc-ddd', '   ', '', null]) {
      const r = await renderEvent({
        viewer: 'anonymous',
        post: { og_image_url, content: 'A Real Title\n\nBody prose kept.' },
      });
      assertNothingEmptyAndNothingLeaked(r, `og_image_url ${JSON.stringify(og_image_url)}`);
      assert.equal(r.ogImage, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8');
      // A whitespace src must be treated as ABSENT, never absolutised into a
      // relative URL pointing at the site root with spaces in it.
      assert.equal(r.flyerSrc, null, `og_image_url ${JSON.stringify(og_image_url)} emitted a broken <img>`);
    }
  });

  it('SPEAKER: an emptied speaker omits the row entirely rather than rendering a blank one', async () => {
    // The speaker is NOT structurally required, so the correct outcome differs
    // from the three above: no meta row, and no JSON-LD performer key at all.
    for (const speaker of ['Meet link: https://meet.google.com/spk-aaaa-bbb', 'PIN: 313131', '   ']) {
      const r = await renderEvent({ viewer: 'anonymous', post: { speaker, content: 'A Real Title\n\nBody prose kept.' } });
      assertNothingEmptyAndNothingLeaked(r, `speaker ${JSON.stringify(speaker)}`);
      assert.equal(r.speakerRow, null, `speaker ${JSON.stringify(speaker)} rendered an empty meta row`);
      assert.equal('performer' in r.jsonLd, false);
    }
  });

  it('ALL FOUR AT ONCE: the maximal emptying input still publishes a complete page', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: {
        title: 'PIN: 313131',
        speaker: 'Dial-in: +1 555-060-1111',
        og_image_url: 'https://meet.google.com/emp-cccc-ddd',
        content: ALL_CREDENTIAL_CONTENT,
      },
    });
    assertNothingEmptyAndNothingLeaked(r, 'the maximal emptying input');
    assert.equal(r.h1, 'Save the Uterus Club Event', 'the title fell through to the constant, as designed');
    assert.equal(r.ogDescription, 'Live members-only call from Save the Uterus Club.');
    assert.equal(r.ogImage, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8');
    assert.equal(r.body, null);
    assert.equal(r.speakerRow, null);
    assert.equal('performer' in r.jsonLd, false);
  });

  it('the .ics carries the same non-empty guarantee, from the same chain as the page', async () => {
    // A deliberate behaviour change, recorded so it is not mistaken for a side
    // effect: the calendar export used to read `event.title` directly with only
    // a generic constant behind it. It now goes through the same safeTitle()
    // chain as the <h1>, because a title that scrubs to nothing needs the SAME
    // non-empty fallback in both places.
    for (const [title, expected] of [
      ['   ', 'SUMMARY:Fallback Chunk Title'],
      ['PIN: 313131', 'SUMMARY:Fallback Chunk Title'],
      ['Meet link: https://meet.google.com/emp-aaaa-bbb', 'SUMMARY:Fallback Chunk Title'],
    ]) {
      const db = await eventDb({ viewer: 'anonymous', post: { title, content: 'Fallback Chunk Title\n\nBody prose.' } });
      try {
        const ics = await (await getEvent(db, { query: '?add=ics' })).text();
        assert.ok(ics.includes(expected), `title ${JSON.stringify(title)} produced: ${/SUMMARY:.*/.exec(ics)?.[0]}`);
        for (const needle of CREDENTIAL_NEEDLES) assert.ok(!ics.includes(needle), `${needle} reached the .ics`);
      } finally { db.close(); }
    }

    const bare = await eventDb({ viewer: 'anonymous', post: { title: '   ', content: '   ' } });
    try {
      const ics = await (await getEvent(bare, { query: '?add=ics' })).text();
      assert.ok(ics.includes('SUMMARY:Save the Uterus Club event'),
        `an all-whitespace row produced: ${/SUMMARY:.*/.exec(ics)?.[0]}`);
    } finally { bare.close(); }
  });

  it('the Google Calendar href is built from the same guarded title and speaker', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: {
        title: 'Meet link: https://meet.google.com/emp-aaaa-bbb',
        speaker: 'Meet link: https://meet.google.com/emp-aaaa-bbb',
        content: 'Fallback Chunk Title\n\nBody prose.',
      },
    });
    const gcal = decodeURIComponent((r.gcalHref ?? '').replace(/&amp;/g, '&'));
    assert.match(gcal, /^https:\/\/calendar\.google\.com\/calendar\/render\?/,
      'the add-to-calendar link was not emitted, so the assertions below prove nothing');
    assert.ok(!gcal.includes('emp-aaaa-bbb'), 'the room reached the Google Calendar template');
    assert.ok(!gcal.includes('meet.google.com'), 'the Meet host reached the Google Calendar template');
    assert.ok(gcal.includes('Fallback Chunk Title'), 'the calendar template lost its title entirely');
  });
});

// =====================================================================
// F. The one over-redaction this scope DOES accept, on the record
// =====================================================================

/**
 * Routing the title and the speaker through the existing patterns means a value
 * that INNOCENTLY matches one of them is replaced rather than published. This
 * block exists so that is a decision on the record rather than a surprise, and
 * so its BOUNDS are pinned: it can only happen for the nine line-anchored
 * patterns that have always applied to the body, and the replacement is always a
 * real second source, never a blank and never the original.
 *
 * If this block ever needs a new entry, the widening that added it is the thing
 * to reconsider -- not this file.
 */
describe('the accepted cost: an innocent value that matches an EXISTING pattern is replaced, not published', () => {
  for (const title of ['Why we left meet.google.com', 'Phone: a history of telemedicine', 'Meet link: what to expect']) {
    it(`${JSON.stringify(title)} falls through to the first content chunk, non-empty and never blank`, async () => {
      const r = await renderEvent({
        viewer: 'anonymous',
        post: { title, content: 'Fallback Chunk Title\n\nBody prose kept.' },
      });
      assert.equal(r.response.status, 200);
      assert.equal(r.h1, 'Fallback Chunk Title');
      assert.ok((r.h1 ?? '').trim().length > 0, 'the heading was published empty');
      assert.match(r.body ?? '', /Body prose kept\./, 'the body was collateral damage, which is a different bug');
    });
  }

  it('the same strings in the BODY are treated identically, so the title is not a special case', async () => {
    // The bound that makes the cost above defensible: nothing new happens to
    // these strings. They have always been removed from the body by the same
    // nine patterns, and this change did not alter that either way.
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\nWhy we left meet.google.com\n\nClosing paragraph, kept.' },
    });
    assert.ok(!(r.body ?? '').includes('meet.google.com'));
    assert.match(r.body ?? '', /Closing paragraph, kept\./);
  });
});

// =====================================================================
// G. The member path is unchanged: all four tiers
// =====================================================================

describe('the member path still receives the join link, and the other tiers still do not', () => {
  const JOIN_LINK = 'https://meet.google.com/gat-eded-xyz';

  for (const viewer of ['member', 'staff']) {
    it(`${viewer}: Join Call still points at event_link`, async () => {
      const r = await renderEvent({
        viewer,
        post: { event_link: JOIN_LINK, content: 'Title chunk.\n\nBody prose.' },
      });
      assert.equal(r.ctaPrimary, JOIN_LINK, `${viewer} lost the join link`);
      assert.equal(r.ctaPrimaryLabel, 'Join Call');
    });

    it(`${viewer}: the unscrubbed body is still rendered, credentials and all`, async () => {
      const r = await renderEvent({
        viewer,
        post: { content: 'Title chunk.\n\nMeet link: https://meet.google.com/mem-aaaa-bbb\n\nPIN: 998877665' },
      });
      assert.ok((r.body ?? '').includes('mem-aaaa-bbb'), `${viewer} lost the joining info from the body`);
      assert.ok((r.body ?? '').includes('998877665'), `${viewer} lost the PIN from the body`);
      // ...but the shared, cacheable sinks are still scrubbed for them too.
      assert.ok(!(r.ogDescription ?? '').includes('mem-aaaa-bbb'));
      assert.ok(!String(r.jsonLd?.description ?? '').includes('mem-aaaa-bbb'));
    });
  }

  for (const viewer of ['anonymous', 'authenticated']) {
    it(`${viewer}: never receives event_link anywhere in the document`, async () => {
      const r = await renderEvent({
        viewer,
        post: { event_link: JOIN_LINK, content: 'Title chunk.\n\nBody prose.' },
      });
      assert.ok(!r.html.includes(JOIN_LINK), `${viewer} received the join link`);
      assert.ok(!r.html.includes('gat-eded-xyz'));
      assert.equal(r.ctaPrimary, 'https://rrmacademy.org/save-the-uterus-club');
    });
  }
});

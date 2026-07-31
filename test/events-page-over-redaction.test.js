/**
 * functions/events/[slug].js -- the ANTI-OVER-REDACTION fixture set.
 *
 * WHY THIS FILE EXISTS, AND WHY IT WAS WRITTEN BEFORE THE SCRUBBER CHANGED
 * -----------------------------------------------------------------------
 * A previous attempt at widening the event-page redaction was rejected, and the
 * reason was not that it missed a credential. It was that it destroyed ordinary
 * clinical prose. It treated BARE WORDS as credential labels -- "room", "zoom",
 * "teams", "call", "dial", "phone", "tel" -- in a reproductive-medicine library
 * where those words are everywhere. The verified casualty was a clinician talk
 * titled "Teams-Based Care in RRM", which scrubbed to the empty string, which
 * then fell through `event.title || summary.title` to a wrong value, on a page
 * whose <h1> is a required field.
 *
 * So the failure mode this file guards is the OPPOSITE of the one
 * events-page-redaction.test.js guards, and the two must be read together:
 *
 *   events-page-redaction.test.js  -- a credential must not survive.
 *   THIS FILE                      -- prose must not die.
 *
 * A redaction change that turns this file red is not a tuning problem. It is
 * the same defect that got the last attempt rejected.
 *
 * IT HAPPENED AGAIN, ON A NARROWER SHAPE
 * --------------------------------------
 * The second attempt shipped a four-digit floor behind strong labels, and
 * "Video Call 2026" -- a label followed by a bare year -- scrubbed to the empty
 * string as a TITLE, exactly as "Teams-Based Care in RRM" had. A four-digit PIN
 * and a four-digit year are the same shape, so the floor moved above both rather
 * than a rule being invented to tell them apart; see MIN_DIGITS_STRONG_LABEL.
 * Two blocks below hold the result, and both iterate the label vocabulary
 * IMPORTED FROM THE MODULE rather than a copy of it, so a label added later is
 * covered without a second edit:
 *
 *   "a four-digit year behind a label is a year, not a PIN"
 *   "nothing required may be emptied: the direct attack on all three fields"
 *
 * THE RULE THIS FILE PINS
 * -----------------------
 * A LABEL ALONE IS NOT A CREDENTIAL. The scrubber may only remove a label when
 * that label is followed by a CREDENTIAL-SHAPED VALUE: a URL, a tel: URI, or a
 * run of at least six digits. "Zoom: <link>" is a credential. "Zoom fatigue in
 * telehealth" is prose. Every case below is a label word standing in prose with
 * no such value behind it, or a number too short (or too date-shaped) to be a
 * PIN, or a filename that merely contains an English word.
 *
 * WHY EACH CASE IS ASSERTED IN EVERY FIELD IT CAN REACH
 * ----------------------------------------------------
 * The title, the speaker and the image are three channels that were previously
 * unscrubbed and are scrubbed now. Widening a scrubber's INPUT is exactly when
 * over-redaction starts hitting fields that are structurally required, so each
 * of the three is asserted at its own sink rather than through the body alone.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderEvent, eventDb, getEvent, sinks } from './_event-page-fixtures.mjs';
import {
  STRONG_LABEL_PHRASES, WEAK_LABEL_PHRASES, ROOM_CODE_LABEL_PHRASES,
} from '../functions/events/[slug].js';

/**
 * Sentences that contain a redaction LABEL but no credential value. Each one is
 * a phrase that plausibly appears in RRM Academy copy. `keep` is the substring
 * that must survive verbatim in the rendered body and in og:description.
 */
const MUST_NOT_REDACT = [
  // The verified casualty of attempt one, and its neighbours.
  { id: 'MN-1', text: 'Teams-Based Care in RRM is the model we are describing.', keep: 'Teams-Based Care in RRM' },
  { id: 'MN-2', text: 'Zoom fatigue in telehealth is a real barrier for patients.', keep: 'Zoom fatigue in telehealth' },
  { id: 'MN-3', text: 'If the chart looks unclear we will call you before the next cycle.', keep: 'we will call you' },
  { id: 'MN-4', text: 'Progesterone requires room temperature storage before reconstitution.', keep: 'room temperature storage' },
  { id: 'MN-5', text: 'We would call a 10-day luteal phase short but not deficient.', keep: 'a 10-day luteal phase' },
  { id: 'MN-6', text: 'The starting dose discussed on the call is 200 mg daily.', keep: '200 mg' },
  { id: 'MN-7', text: 'Registration closes 2026-07-31 for this cohort.', keep: '2026-07-31' },

  // The rest of the label vocabulary, each standing in innocent prose.
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

  // --- the bare-year casualty, and the hyphenated-word casualty ------------
  // MN-19 is the verified failure this round: a STRONG label followed by a bare
  // four-digit year. It scrubbed to the empty string as a title, which then
  // published a heading derived from a blank. It is asserted as the whole title
  // deliberately, because that is the shape that broke.
  { id: 'MN-19', text: 'Video Call 2026', keep: 'Video Call 2026' },
  { id: 'MN-20', text: 'Video Call 2026-2027 spans two academic years.', keep: 'Video Call 2026-2027' },
  { id: 'MN-21', text: 'Join Call 1999 was the first of the retrospective series.', keep: 'Join Call 1999' },
  // The hyphenated-word casualty the bare-room-code rule could have caused.
  // "follicle-stimulating hormone" is named in the brief; "two-week-old" is the
  // harder case, because it IS the 3-4-3 room-code shape and must still survive
  // when no conferencing label stands in front of it.
  { id: 'MN-22', text: 'Serum follicle-stimulating hormone is drawn on cycle day 3.', keep: 'follicle-stimulating hormone' },
  { id: 'MN-23', text: 'The two-week-old sample was re-run before the chart review.', keep: 'two-week-old' },
  { id: 'MN-24', text: 'Add-back therapy with norethindrone acetate is discussed.', keep: 'Add-back therapy' },
];

describe('the scrubber must not eat clinical prose (a label alone is not a credential)', () => {
  for (const { id, text, keep } of MUST_NOT_REDACT) {
    it(`${id}: keeps "${keep}"`, async () => {
      const r = await renderEvent({
        viewer: 'anonymous',
        post: { content: `Title chunk.\n\n${text}` },
      });
      assert.equal(r.response.status, 200);
      assert.ok((r.body ?? '').includes(keep),
        `${id} was over-redacted out of the rendered body.\n  wanted: ${JSON.stringify(keep)}\n  body:   ${JSON.stringify(r.body)}`);
      assert.ok((r.ogDescription ?? '').includes(keep),
        `${id} was over-redacted out of og:description.\n  og:     ${JSON.stringify(r.ogDescription)}`);
      assert.ok((r.jsonLd?.description ?? '').includes(keep),
        `${id} was over-redacted out of the JSON-LD description`);
    });
  }
});

/**
 * A BARE YEAR AFTER EVERY LABEL IN THE VOCABULARY.
 *
 * The vocabularies are imported from the module rather than transcribed here, so
 * a label added to STRONG_JOIN_LABELS tomorrow is covered by this fixture the
 * moment it is added. Transcribing the list is how the file that is supposed to
 * catch over-redaction stops covering the labels that cause it.
 *
 * Both the title sink and the body sink, because the title is the one that broke:
 * an emptied body is visible, an emptied title publishes a wrong <h1> silently.
 * Both the bare form ("Video Call 2026") and the colon form ("Video Call: 2026"),
 * because a colon is how an author writes a subtitle and is NOT evidence of a
 * credential.
 */
function yearFixtures(phrase) {
  return [`${phrase} 2026`, `${phrase}: 2026`, `${phrase} 1999-2000`];
}

describe('a four-digit year behind a label is a year, not a PIN', () => {
  for (const phrase of STRONG_LABEL_PHRASES) {
    it(`STRONG label "${phrase}" does not claim the year behind it`, async () => {
      for (const text of yearFixtures(phrase)) {
        const asTitle = await renderEvent({ viewer: 'anonymous', post: { title: text, content: 'T.\n\nB.' } });
        assert.equal(asTitle.h1, text, `"${text}" was rewritten in <h1>`);
        assert.equal(asTitle.ogTitle, `${text} | Save the Uterus Club`, `"${text}" was rewritten in og:title`);
        assert.equal(asTitle.jsonLd?.name, text, `"${text}" was rewritten in the JSON-LD name`);

        const asBody = await renderEvent({ viewer: 'anonymous', post: { content: `Title chunk.\n\n${text}` } });
        assert.ok((asBody.body ?? '').includes(text), `"${text}" was over-redacted out of the body`);
        assert.ok((asBody.ogDescription ?? '').includes(text), `"${text}" was over-redacted out of og:description`);
      }
    });
  }

  for (const phrase of WEAK_LABEL_PHRASES) {
    it(`WEAK label "${phrase}" does not claim the year behind it`, async () => {
      for (const text of yearFixtures(phrase)) {
        const r = await renderEvent({ viewer: 'anonymous', post: { title: text, content: `Title chunk.\n\n${text}` } });
        assert.equal(r.h1, text, `"${text}" was rewritten in <h1>`);
        assert.ok((r.body ?? '').includes(text), `"${text}" was over-redacted out of the body`);
      }
    });
  }

  it('a five-digit run behind a strong label IS still redacted, so the floor moved by one and not by three', async () => {
    // The counterweight to the whole block above. Raising the strong floor to
    // five is only defensible if five still redacts; a floor that quietly became
    // "never redact a labelled number" would pass every assertion above.
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\nPasscode: 44715\n\nClosing paragraph, kept.' },
    });
    assert.ok(!r.html.includes('44715'), 'a five-digit passcode leaked; the digit floor is not where it claims to be');
    assert.ok((r.body ?? '').includes('Closing paragraph, kept.'));
  });
});

/**
 * A GOOGLE MEET ROOM CODE IS REDACTED ONLY BEHIND A CONFERENCING LABEL.
 *
 * The rule that closes "Google Meet: abc-defg-hij" is one hyphen-shape away from
 * a rule that deletes hyphenated clinical vocabulary, so the shape is pinned in
 * both directions: the code goes when a conferencing label names it, and an
 * ordinary hyphenated term stays whether or not it happens to be 3-4-3.
 */
describe('the bare room-code rule must not become a rule about hyphenated words', () => {
  const HYPHENATED_PROSE = [
    'follicle-stimulating hormone',
    'luteinizing-hormone surge',
    'add-back therapy',
    'two-week-old sample',
    'first-line-of-care pathway',
    'day-three-day protocols',
  ];

  for (const phrase of HYPHENATED_PROSE) {
    it(`keeps "${phrase}" when no conferencing label precedes it`, async () => {
      const text = `We reviewed ${phrase} in the second half of the call.`;
      const r = await renderEvent({ viewer: 'anonymous', post: { title: text, content: `Title chunk.\n\n${text}` } });
      assert.ok((r.body ?? '').includes(phrase), `"${phrase}" was deleted from the body`);
      assert.ok((r.h1 ?? '').includes(phrase), `"${phrase}" was deleted from <h1>`);
      assert.ok((r.ogDescription ?? '').includes(phrase), `"${phrase}" was deleted from og:description`);
    });
  }

  it('keeps a 3-4-3 hyphenated term even directly behind a NON-conferencing label', async () => {
    // "Room" and "call" are weak labels, and weak labels never earn a room-code
    // redaction. This is the case that separates "only after a strong
    // conferencing label" from "after anything in the vocabulary".
    for (const text of ['Room: two-week-old samples only', 'We will call the two-week-old cohort first']) {
      const r = await renderEvent({ viewer: 'anonymous', post: { content: `Title chunk.\n\n${text}` } });
      assert.ok((r.body ?? '').includes('two-week-old'), `"${text}" lost its hyphenated term`);
    }
  });

  it('keeps the label itself when the value behind it is NOT the room-code shape', async () => {
    // The label alone is not a credential here either: "Meeting code" followed
    // by prose is prose.
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\nMeeting code of conduct is published on the members page.' },
    });
    assert.ok((r.body ?? '').includes('Meeting code of conduct is published'),
      `the label was deleted with no credential behind it: ${JSON.stringify(r.body)}`);
  });

  it('every conferencing label in the vocabulary DOES take a real room code with it', async () => {
    // The positive half, iterated over the same exported list, so a label added
    // to ROOM_CODE_LABELS is proved to work rather than assumed to.
    for (const phrase of ROOM_CODE_LABEL_PHRASES) {
      const r = await renderEvent({
        viewer: 'anonymous',
        post: { content: `Title chunk.\n\n${phrase}: xyz-abcd-efg\n\nClosing paragraph, kept.` },
      });
      assert.ok(!r.html.includes('xyz-abcd-efg'), `"${phrase}" did not take the room code with it`);
      assert.ok((r.body ?? '').includes('Closing paragraph, kept.'),
        `"${phrase}" ate the surrounding prose, which is over-redaction, not redaction`);
    }
  });
});

describe('the three newly-scrubbed channels must survive an innocent value', () => {
  // TITLE. This is the field that broke last time: it is required, it has no
  // safe second source, and an empty one silently fell through to a wrong value.
  for (const { id, text, keep } of MUST_NOT_REDACT) {
    it(`${id}: an innocent title survives into <h1>, <title>, og:title and JSON-LD`, async () => {
      const r = await renderEvent({ viewer: 'anonymous', post: { title: text, content: 'T.\n\nB.' } });
      assert.ok((r.h1 ?? '').includes(keep), `${id} was over-redacted out of <h1>: ${JSON.stringify(r.h1)}`);
      assert.ok((r.docTitle ?? '').includes(keep), `${id} was over-redacted out of <title>`);
      assert.ok((r.ogTitle ?? '').includes(keep), `${id} was over-redacted out of og:title`);
      assert.ok(String(r.jsonLd?.name ?? '').includes(keep), `${id} was over-redacted out of JSON-LD name`);
    });
  }

  // SPEAKER, both arms: the column and the "Speaker:" line in the content.
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

  // IMAGE. A filename is not prose: matching a rule anywhere in the URL STRING
  // is what dropped legitimate flyers last time. Only the HOST may decide.
  const INNOCENT_IMAGES = [
    'https://cdn.example/endo-call-2026.jpg',
    'https://cdn.example/zoom-in-on-the-ultrasound.png',
    'https://cdn.example/teams/room-101/pin-board.webp',
    'https://cdn.example/dial-in-to-your-cycle.jpg',
    '/images/meet-the-team-2026.png',
  ];

  for (const src of INNOCENT_IMAGES) {
    it(`keeps the flyer at ${src}`, async () => {
      const fromColumn = await renderEvent({
        viewer: 'anonymous',
        post: { og_image_url: src, content: 'T.\n\nB.' },
      });
      assert.ok(fromColumn.flyerSrc, `og_image_url ${src} was dropped from the rendered flyer`);
      assert.ok(fromColumn.ogImage.endsWith(src.replace(/^\//, '')), `og:image lost ${src}`);

      const fromContent = await renderEvent({
        viewer: 'anonymous',
        post: { og_image_url: null, content: `T.\n\n![flyer](${src})\n\nB.` },
      });
      assert.ok(fromContent.flyerSrc, `the markdown image ${src} was dropped from the rendered flyer`);
    });
  }
});

describe('nothing structurally required may become empty as a RESULT of scrubbing', () => {
  // The precise failure of attempt one: title scrubbed to '', which then fell
  // through `event.title || summary.title` to the first content chunk.
  const ALL_CREDENTIAL_TITLES = [
    'PIN: 313131',
    'Meet link: https://meet.google.com/ttl-aaaa-bbb',
    'https://meet.google.com/ttl-cccc-ddd',
    'Dial-in: +1 555-040-1111',
    'Passcode: 424242',
  ];

  for (const title of ALL_CREDENTIAL_TITLES) {
    it(`a title that is NOTHING BUT a credential still renders a non-empty heading: ${JSON.stringify(title)}`, async () => {
      const r = await renderEvent({
        viewer: 'anonymous',
        post: { title, content: 'Fallback Chunk Title\n\nBody prose.' },
      });
      assert.equal(r.response.status, 200);
      for (const [field, value] of [['<h1>', r.h1], ['<title>', r.docTitle], ['og:title', r.ogTitle], ['JSON-LD name', r.jsonLd?.name]]) {
        assert.ok(value && String(value).trim().length > 0, `${field} was published empty`);
      }
      // ...and the fallback is a real one, not the credential leaking back in.
      assert.ok(!r.html.includes('313131'));
      assert.ok(!r.html.includes('ttl-aaaa-bbb'));
      assert.ok(!r.html.includes('ttl-cccc-ddd'));
      assert.ok(!r.html.includes('555-040-1111'));
      assert.ok(!r.html.includes('424242'));
    });
  }

  it('a description that scrubs to nothing falls back to the generic line, never to empty', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { title: '', content: 'Real Title\n\nPIN: 515151\n\nMeet link: https://meet.google.com/dsc-aaaa-bbb' },
    });
    assert.equal(r.ogDescription, 'Live members-only call from Save the Uterus Club.');
    assert.equal(r.metaDescription, 'Live members-only call from Save the Uterus Club.');
    assert.equal(r.jsonLd.description, 'Live members-only call from Save the Uterus Club.');
    assert.equal(r.h1, 'Real Title');
  });

  it('the .ics SUMMARY uses the same fallback chain as the page, so the two cannot disagree', async () => {
    // A deliberate behaviour change, recorded here so it is not mistaken for a
    // side effect: the calendar export used to read `event.title` directly with
    // only a generic constant behind it. It now goes through the same
    // safeTitle() chain as the <h1>, because a title that scrubs to nothing
    // needs the SAME non-empty fallback in both places -- otherwise the page
    // says one thing and the calendar entry another.
    const db = await eventDb({
      viewer: 'anonymous',
      post: { title: '', content: 'Fallback Chunk Title\n\nBody prose.' },
    });
    try {
      const s = sinks(await (await getEvent(db)).text());
      const ics = await (await getEvent(db, { query: '?add=ics' })).text();
      assert.equal(s.h1, 'Fallback Chunk Title');
      assert.ok(ics.includes('SUMMARY:Fallback Chunk Title'),
        `the calendar entry disagreed with the page: ${/SUMMARY:.*/.exec(ics)?.[0]}`);
    } finally { db.close(); }

    // With no content either, both still land on the constant.
    const bare = await eventDb({ viewer: 'anonymous', post: { title: '', content: null } });
    try {
      const ics = await (await getEvent(bare, { query: '?add=ics' })).text();
      assert.ok(ics.includes('SUMMARY:Save the Uterus Club event'));
    } finally { bare.close(); }
  });

  it('a scrubbed speaker reads as a name, not as leftover punctuation', async () => {
    for (const [column, expected] of [
      ['Dr Ada (PIN 660011)', 'Dr Ada'],
      ['Dr Ada, dial 555-020-9999', 'Dr Ada'],
      ['Dr Ada [PIN: 660012]', 'Dr Ada'],
      ['Dr Naomi Whittaker, MD', 'Dr Naomi Whittaker, MD'],
    ]) {
      const r = await renderEvent({ viewer: 'anonymous', post: { speaker: column, content: 'T.\n\nB.' } });
      assert.equal(r.speakerRow, expected, `speaker ${JSON.stringify(column)} rendered badly`);
    }
  });

  it('an image that IS the Meet room falls back to the branded card, not to an empty src', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { og_image_url: 'https://meet.google.com/img-aaaa-bbb', content: 'T.\n\nB.' },
    });
    assert.equal(r.flyerSrc, null, 'no flyer element should be emitted rather than an empty one');
    assert.equal(r.ogImage, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8');
    assert.ok(!r.html.includes('img-aaaa-bbb'));
  });
});

/**
 * NO FIELD MAY EVER BE EMPTIED BY SCRUBBING.
 *
 * The block above proves it for a title. This one attacks the requirement
 * directly and for all three required fields at once: it feeds inputs whose
 * ONLY purpose is to make the scrubber return the empty string, and asserts that
 * every required sink is still non-empty and still carries no credential.
 *
 * WHY THE LAST RESORT IS A CONSTANT AND NOT THE UNSCRUBBED ORIGINAL
 * ----------------------------------------------------------------
 * "Fall back to what was there before scrubbing" is the obvious guard and it is
 * the wrong one here, because of what it would be falling back TO. There is no
 * input on which scrubbing empties one of these fields innocently: reaching
 * blank requires the whole field to have matched a credential rule, so the
 * unscrubbed original IS the credential. Every case below is asserted twice for
 * that reason -- non-empty, AND the credential absent -- so a future change that
 * satisfies "never empty" by republishing the original turns this file red
 * rather than green.
 */
describe('nothing required may be emptied: the direct attack on all three fields', () => {
  const ALL_CREDENTIAL_CONTENT =
    'PIN: 998877665\n\nMeet link: https://meet.google.com/emp-aaaa-bbb\n\nDial-in: +1 555-060-1111';
  const CREDENTIAL_NEEDLES = ['998877665', 'emp-aaaa-bbb', 'meet.google.com', '555-060-1111', 'emp-cccc-ddd'];

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

  it('TITLE: every title that scrubs to nothing still publishes a heading, from a safe source', async () => {
    for (const title of [
      'PIN: 998877665',
      '**PIN: 998877665**',
      '- Meet link: https://meet.google.com/emp-aaaa-bbb',
      'https://meet.google.com/emp-aaaa-bbb',
      'Google Meet: emp-aaaa-bbb',
      'Dial-in: +1 555-060-1111',
      '   ',
      '',
    ]) {
      const r = await renderEvent({
        viewer: 'anonymous',
        post: { title, content: 'Fallback Chunk Title\n\nBody prose kept.' },
      });
      assertNothingEmptyAndNothingLeaked(r, `title ${JSON.stringify(title)}`);
      assert.equal(r.h1, 'Fallback Chunk Title',
        `title ${JSON.stringify(title)} did not fall through to the scrubbed first content chunk`);
    }
  });

  it('DESCRIPTION: content that scrubs to nothing still publishes a description', async () => {
    for (const content of [ALL_CREDENTIAL_CONTENT, '   ', '\n\n\n', null]) {
      const r = await renderEvent({ viewer: 'anonymous', post: { title: 'A Real Title', content } });
      assertNothingEmptyAndNothingLeaked(r, `content ${JSON.stringify(content)}`);
      assert.equal(r.ogDescription, 'Live members-only call from Save the Uterus Club.');
      assert.equal(r.metaDescription, 'Live members-only call from Save the Uterus Club.');
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

  it('ALL THREE AT ONCE: the maximal emptying input still publishes a complete page', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: {
        title: 'PIN: 998877665',
        speaker: 'Dial-in: +1 555-060-1111',
        og_image_url: 'https://meet.google.com/emp-cccc-ddd',
        content: ALL_CREDENTIAL_CONTENT,
      },
    });
    assertNothingEmptyAndNothingLeaked(r, 'the maximal emptying input');
    assert.equal(r.h1, 'Save the Uterus Club Event', 'the title fell through to the constant, as designed');
    assert.equal(r.ogDescription, 'Live members-only call from Save the Uterus Club.');
    assert.equal(r.ogImage, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8');
    // The speaker is NOT a required field: an omitted row is correct, an empty
    // one is not.
    assert.equal(r.speakerRow, null);
    assert.equal('performer' in r.jsonLd, false);
  });

  it('the .ics carries the same non-empty guarantee, including for a whitespace-only title', async () => {
    for (const [title, expected] of [
      ['   ', 'SUMMARY:Fallback Chunk Title'],
      ['PIN: 998877665', 'SUMMARY:Fallback Chunk Title'],
    ]) {
      const db = await eventDb({
        viewer: 'anonymous',
        post: { title, content: 'Fallback Chunk Title\n\nBody prose.' },
      });
      try {
        const ics = await (await getEvent(db, { query: '?add=ics' })).text();
        assert.ok(ics.includes(expected), `title ${JSON.stringify(title)} produced: ${/SUMMARY:.*/.exec(ics)?.[0]}`);
        assert.ok(!ics.includes('998877665'));
      } finally { db.close(); }
    }

    const bare = await eventDb({ viewer: 'anonymous', post: { title: '   ', content: '   ' } });
    try {
      const ics = await (await getEvent(bare, { query: '?add=ics' })).text();
      assert.ok(ics.includes('SUMMARY:Save the Uterus Club event'),
        `an all-whitespace row produced: ${/SUMMARY:.*/.exec(ics)?.[0]}`);
    } finally { bare.close(); }
  });
});

describe('markdown structure outside the matched span is left alone', () => {
  // Attempt one collapsed nested list indentation and indented code blocks with
  // a document-wide whitespace tidy. The span-scoped replacement must not.
  it('preserves nested list indentation on lines it did not touch', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'T.\n\n- Item one\n  - Sub item A\n    - Sub sub item\n- Item two' },
    });
    assert.ok((r.body ?? '').includes('- Item one\n  - Sub item A\n    - Sub sub item\n- Item two'),
      `list indentation was rewritten: ${JSON.stringify(r.body)}`);
  });

  it('preserves an indented code block when a credential is redacted elsewhere in the post', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'T.\n\n    const x = 1;\n        const y = 2;\n\nPIN: 606060\n\nTail prose.' },
    });
    // summarize() has always trimmed each chunk, so the FIRST line's leading
    // indent is lost before the scrubber is involved. What a document-wide
    // whitespace tidy destroys, and what is asserted here, is the indentation
    // INSIDE the block.
    assert.ok((r.body ?? '').includes('const x = 1;\n        const y = 2;'),
      `code-block indentation was rewritten: ${JSON.stringify(r.body)}`);
    assert.ok(!r.html.includes('606060'));
    assert.ok((r.body ?? '').includes('Tail prose.'));
  });

  it('removes only the matched span from a line, leaving the sentence around it', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'T.\n\nEverything you need follows. PIN: 445566 See you Tuesday.' },
    });
    assert.ok((r.body ?? '').includes('Everything you need follows.'));
    assert.ok((r.body ?? '').includes('See you Tuesday.'));
    assert.ok(!r.html.includes('445566'));
  });
});

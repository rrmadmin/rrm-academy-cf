/**
 * functions/events/[slug].js -- ADVERSARIAL pass over the join-credential
 * redaction, run against the suite in events-page-redaction.test.js rather
 * than with it.
 *
 * That suite proved each of scrubJoinInfo()'s patterns redacts what it claims,
 * and reported sixteen formats that slip past. This file is the independent
 * attack on the same code: formats devised without reference to the pattern
 * list, and -- more importantly -- SINKS THAT SUITE NEVER LOOKED AT.
 *
 * The finding that mattered most was EV-X0. redactionSinks() audits five
 * strings: the rendered body, og:description, twitter:description, the meta
 * description and the JSON-LD. og:image, twitter:image, the JSON-LD `image`
 * field and the rendered flyer <img src> are not among them, and summarize()
 * captured firstImage from the markdown BEFORE scrubJoinInfo() ran. So a
 * markdown IMAGE whose src was the Meet room published the live joining URL in
 * four places, and every assertion in the existing suite passed while it did.
 *
 * EV-X0 IS NOW CLOSED. An <img> src is judged on its parsed HOSTNAME -- never on
 * its path or its filename, because "endo-call-2026.jpg" is a flyer -- and the
 * host is normalised once so a trailing root dot cannot defeat the comparison.
 * The closure is asserted on all four image sinks in
 * test/events-page-over-redaction.test.js; the block below is now the control
 * that keeps it closed.
 *
 * HOW TO READ THE ASSERTIONS
 * -------------------------
 * Same convention as the suite it extends: a case named "LEAKS ..." asserts the
 * credential IS present, because that is what the deployed code does today.
 * When the redaction is fixed the case goes red and names the finding that was
 * closed. Nothing here changes production code; the fix is a product decision.
 *
 * No live exposure was found. All nineteen event rows in production were
 * checked against these formats and none contains one. These are latent.
 *
 * WHAT IS NOT A FINDING
 * ---------------------
 * The JSON-LD was re-attacked independently, including U+2028 and U+2029 (legal
 * inside a JSON string, fatal inside an inline script), lone surrogates, `-->`,
 * `]]>` and a pre-escaped `<\/script>`. It held in every case. Those cases are
 * kept below as guards rather than as findings.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventDb, getEvent, renderEvent, sinks, redactionSinks, appearsIn,
} from './_event-page-fixtures.mjs';

/** Prose either side, so "the credential is gone" can never mean "the page is gone". */
function contentAround(line) {
  return `Opening paragraph, kept.\n\n${line}\n\nClosing paragraph, kept.`;
}

const ALL_FIVE = ['rendered body', 'og:description', 'twitter:description', 'meta description', 'schema.org JSON-LD'];

function leakingSinks(s, needle) {
  return redactionSinks(s).filter(([, value]) => appearsIn(value, needle)).map(([name]) => name);
}

/** Asserts the page still rendered the surrounding prose, so an absence result means something. */
function assertPageAlive(r) {
  assert.match(r.body ?? '', /Closing paragraph, kept\./,
    'the surrounding prose vanished, so any absence assertion in this case proves nothing');
}

// =====================================================================
// EV-X0. The image channel: four sinks the redaction never sees
// =====================================================================

describe('the flyer channel -- summarize() captures firstImage BEFORE scrubJoinInfo runs', () => {
  it('EV-X0 CLOSED: a markdown IMAGE whose src is the Meet room reaches none of the four image sinks', async () => {
    // Was one "!" apart from the fully-redacted form asserted in the control
    // below: summarize() pulled the src out in the ![...](...) replace, recorded
    // it as firstImage, and renderHtml used it for ogImage without it ever
    // passing through scrubJoinInfo. The capture now refuses a src whose HOST
    // serves meeting rooms, so the sinks that scrubJoinInfo cannot reach are
    // closed at the point of capture instead.
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\n![Join the call](https://meet.google.com/img-aaaa-bbb)\n\nSee you there.' },
    });

    assert.equal(r.response.status, 200);
    const twitterImage = /<meta name="twitter:image" content="([^"]*)">/.exec(r.html)?.[1] ?? '';

    assert.equal(r.ogImage, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8',
      'EV-X0 reopened in og:image');
    assert.equal(twitterImage, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8', 'EV-X0 reopened in twitter:image');
    assert.equal(r.jsonLd.image, 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8', 'EV-X0 reopened in JSON-LD image');
    assert.equal(r.flyerSrc, null, 'EV-X0 reopened in the rendered flyer src');

    // And the five prose sinks the original audit DID cover stay clean, so the
    // closure was not bought by moving the URL somewhere else in the document.
    assert.deepEqual(leakingSinks(r, 'img-aaaa-bbb'), [],
      'the room is still somewhere in the audited sinks');
    assert.ok(!r.html.includes('img-aaaa-bbb'), 'the room reached the document somewhere');
    assert.ok(!appearsIn(r.ogDescription ?? '', 'img-aaaa-bbb'));
    assert.ok(!appearsIn(r.body ?? '', 'img-aaaa-bbb'));
    assert.match(r.body ?? '', /See you there\./);
  });

  it('the same URL as a markdown LINK is fully redacted -- the control that made EV-X0 a one-character defect', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\n[Join the call](https://meet.google.com/lnk-aaaa-bbb)\n\nSee you there.' },
    });
    assert.deepEqual(leakingSinks(r, 'lnk-aaaa-bbb'), []);
    assert.ok(!r.html.includes('lnk-aaaa-bbb'), 'the link form should not reach the document at all');
    assert.match(r.body ?? '', /See you there\./);
  });

  it('an og_image_url column takes precedence, so a row with a real flyer is not exposed by EV-X0', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: {
        og_image_url: 'https://cdn.example/flyer.png',
        content: 'Title chunk.\n\n![Join](https://meet.google.com/pre-aaaa-bbb)\n\nSee you there.',
      },
    });
    assert.equal(r.ogImage, 'https://cdn.example/flyer.png');
    assert.ok(!r.html.includes('pre-aaaa-bbb'),
      'og_image_url won, so firstImage was never used and nothing leaked');
  });

  it('a credential in the image ALT text does not leak, because the alt is discarded entirely', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\n![PIN: 778899](https://cdn.example/f.png)\n\nSee you there.' },
    });
    assert.ok(!r.html.includes('778899'), 'the alt text reached the document');
    assert.equal(r.flyerSrc, 'https://cdn.example/f.png');
  });
});

// =====================================================================
// EV-X1..X7. Formats the pattern list does not anticipate
// =====================================================================

/**
 * Every case reaches all five audited sinks on a page an anonymous visitor
 * sees. Grouped by the mechanism that defeats the pattern, because the fix is
 * one decision per class, not one regex per line.
 */
const NEW_LEAKS = [
  // --- EV-X1: markdown decoration before an ALLOWLISTED label ----------
  // `^\s*pin\s*:` requires the label to be the first non-space thing on the
  // line. A bullet, a number, a blockquote marker or bold emphasis is not \s.
  // Every one of these labels IS in the allowlist; only the decoration is new.
  { id: 'EV-X1a', why: 'a "- " bullet before an allowlisted PIN label', line: '- PIN: 445561', needle: '445561' },
  { id: 'EV-X1b', why: 'a "* " bullet before an allowlisted PIN label', line: '* PIN: 445562', needle: '445562' },
  { id: 'EV-X1c', why: 'markdown bold around an allowlisted PIN label', line: '**PIN:** 445563', needle: '445563' },
  { id: 'EV-X1d', why: 'a numbered-list marker before an allowlisted PIN label', line: '1. PIN: 445564', needle: '445564' },
  { id: 'EV-X1e', why: 'a blockquote marker before an allowlisted PIN label', line: '> PIN: 445565', needle: '445565' },
  { id: 'EV-X1f', why: 'a heading marker before an allowlisted Dial-in label', line: '### Dial-in: +1 555-041-1111', needle: '555-041-1111' },
  { id: 'EV-X1g', why: 'a bullet before an allowlisted Meet link label', line: '- Meet link: https://video.example/room-x1g', needle: 'room-x1g' },

  // --- EV-X2: an allowlisted label with one extra word -----------------
  // Each pattern demands the colon IMMEDIATELY after the keyword. One space or
  // one qualifier -- the way people actually write these -- and it is inert.
  { id: 'EV-X2a', why: '"Dial in:" with a space instead of a hyphen', line: 'Dial in: +1 555-042-1111', needle: '555-042-1111' },
  { id: 'EV-X2b', why: '"Phone number:" -- the allowlist matches only a bare "Phone:"', line: 'Phone number: +1 555-042-2222', needle: '555-042-2222' },
  { id: 'EV-X2c', why: '"PIN code:" -- the allowlist matches only a bare "PIN:"', line: 'PIN code: 445570', needle: '445570' },
  { id: 'EV-X2d', why: '"Dial-in number:" -- a qualifier after an allowlisted label', line: 'Dial-in number: +1 555-042-3333', needle: '555-042-3333' },
  { id: 'EV-X2e', why: '"Google Meet:" without the word "link" or "join" matches no pattern', line: 'Google Meet: https://video.example/room-x2e', needle: 'room-x2e' },

  // --- EV-X3: the label on its own line, the value on the next ---------
  // The worst outcome available: the pattern deletes the LABEL and leaves the
  // bare credential behind, so the published page carries a naked PIN with
  // nothing left to mark it as one.
  { id: 'EV-X3a', why: 'a PIN label on its own line: the label is deleted and the bare PIN survives', line: 'PIN:\n445580', needle: '445580' },
  { id: 'EV-X3b', why: 'a Dial-in label on its own line: the number survives unlabelled', line: 'Dial-in:\n+1 555-043-1111', needle: '555-043-1111' },
  { id: 'EV-X3c', why: 'a Meet link label on its own line: the URL survives unlabelled', line: 'Meet link:\nhttps://video.example/room-x3c', needle: 'room-x3c' },

  // --- EV-X4: the HOST broken across a soft wrap -----------------------
  // Distinct from the wrapped-tail case already reported: breaking inside the
  // host means NO pattern fires at all, so the entire room code survives on an
  // otherwise intact line.
  { id: 'EV-X4a', why: 'the meet.google.com host itself split across a wrap: no pattern fires at all', line: 'Join at https://meet.\ngoogle.com/hst-aaaa-bbb before 6pm.', needle: 'hst-aaaa-bbb' },
  { id: 'EV-X4b', why: 'markdown emphasis inside the host breaks the literal match', line: 'Join at meet.**google**.com/bld-aaaa-bbb today.', needle: 'bld-aaaa-bbb' },

  // --- EV-X5: an invisible character that is NOT \s --------------------
  // `\s` covers NBSP and the BOM (proven by the controls below), but not the
  // zero-width space, the directional marks or the soft hyphen -- exactly what
  // a paste out of a document or a chat client carries.
  { id: 'EV-X5a', why: 'U+200B zero-width space before an allowlisted PIN label', line: '\u200BPIN: 445590', needle: '445590' },
  { id: 'EV-X5b', why: 'U+200E left-to-right mark before an allowlisted PIN label', line: '\u200EPIN: 445591', needle: '445591' },
  { id: 'EV-X5c', why: 'U+00AD soft hyphen before an allowlisted PIN label', line: '\u00ADPIN: 445593', needle: '445593' },

  // --- EV-X6: a separator that is not an ASCII colon -------------------
  { id: 'EV-X6a', why: 'a hyphen instead of a colon after an allowlisted label', line: 'PIN - 445601', needle: '445601' },
  { id: 'EV-X6b', why: 'an equals sign instead of a colon', line: 'PIN = 445602', needle: '445602' },
  { id: 'EV-X6c', why: 'a hash instead of a colon', line: 'PIN #445603', needle: '445603' },
  { id: 'EV-X6d', why: 'U+FF1A fullwidth colon instead of an ASCII one', line: 'PIN\uFF1A 445600', needle: '445600' },
  { id: 'EV-X6e', why: 'an en dash instead of a colon after an allowlisted label', line: 'Dial-in \u2013 +1 555-044-1111', needle: '555-044-1111' },

  // --- EV-X7: the host as something other than the literal string ------
  { id: 'EV-X7a', why: 'a Cyrillic homoglyph inside the host defeats the literal match', line: 'Join at https://meet.googl\u0435.com/cyr-aaaa-bbb today.', needle: 'cyr-aaaa-bbb' },
  { id: 'EV-X7b', why: 'percent-encoded dots inside the host defeat the literal match', line: 'Join at https://meet%2Egoogle%2Ecom/pct-aaaa-bbb today.', needle: 'pct-aaaa-bbb' },
];

describe('scrubJoinInfo -- an independent leak hunt (formats the first pass did not try)', () => {
  for (const { id, why, line, needle } of NEW_LEAKS) {
    it(`LEAKS ${id}: ${why}`, async () => {
      const r = await renderEvent({ viewer: 'anonymous', post: { content: contentAround(line) } });
      assert.equal(r.response.status, 200);
      assert.deepEqual(
        leakingSinks(r, needle), ALL_FIVE,
        `${id} no longer reaches every public sink. If ${JSON.stringify(needle)} is now redacted, `
        + 'the finding is FIXED: delete this case and add it to PATTERN_CASES in events-page-redaction.test.js.'
      );
      assertPageAlive(r);
    });
  }

  it('EV-X3 leaves the credential with its own label stripped off, which is the worst shape available', async () => {
    // Named separately because the ID list above only proves presence. What
    // makes EV-X3 worse than the rest is WHAT survives: a reviewer skimming the
    // published page sees a bare number, not a line that says "PIN".
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('PIN:\n445580') },
    });
    // "Opening paragraph, kept." is chunk 0, which renderHtml treats as the
    // title and drops from the body, so the body starts at the surviving PIN.
    assert.equal(r.body, '<p>445580</p>\n<p>Closing paragraph, kept.</p>',
      'the PIN label should be gone and the bare PIN left behind; if this changed, re-read EV-X3');
    assert.equal(r.ogDescription, '445580 Closing paragraph, kept.',
      'the unlabelled PIN is the first thing a link preview shows');
    assert.ok(!(r.body ?? '').includes('PIN:'), 'the label itself was correctly removed, which is the trap');
  });

  it('EV-X4a leaves the WHOLE room code, unlike the wrapped-tail case: the sentence survives intact', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('Join at https://meet.\ngoogle.com/hst-aaaa-bbb before 6pm.') },
    });
    assert.match(r.body ?? '', /Join at https:\/\/meet\.\ngoogle\.com\/hst-aaaa-bbb before 6pm\./,
      'nothing was removed at all, because no pattern matched');
  });

  it('U+00A0 and U+FEFF before the same label ARE redacted: the EV-X5 class is about \\s, not about invisibility', async () => {
    // The control that makes EV-X5 a statement about the character class rather
    // than a vague "unicode breaks it". JS \s includes NBSP and the BOM.
    for (const [name, ch, needle] of [['U+00A0 NBSP', '\u00A0', '445594'], ['U+FEFF BOM', '\uFEFF', '445592']]) {
      const r = await renderEvent({ viewer: 'anonymous', post: { content: contentAround(`${ch}PIN: ${needle}`) } });
      assert.deepEqual(leakingSinks(r, needle), [], `${name} was expected to be inside \\s and to redact`);
      assertPageAlive(r);
    }
  });
});

// =====================================================================
// EV-X8, EV-X9. Channels around the scrubber, not through it
// =====================================================================

describe('the channels around the scrubber, now on its path but bounded by its vocabulary', () => {
  it('EV-X8 PARTIALLY CLOSED: the speaker COLUMN is scrubbed now, but a mid-line label is outside the vocabulary', async () => {
    // Both arms of `event.speaker || extractSpeaker(...)` now run through the
    // SAME unmodified patterns the body runs, so a conferencing HOST typed
    // beside a speaker name is removed (asserted in the closure case below).
    // What is NOT removed is this: the patterns require a label at the START of
    // a line followed by a colon, and "Dr Ada (PIN 660011)" is neither. That is
    // the residual the module header names -- the label vocabulary was
    // deliberately not widened over prose, because three attempts to widen it
    // destroyed clinical English. The operational fix is event_link, not a regex.
    const db = await eventDb({
      viewer: 'anonymous',
      post: { speaker: 'Dr Ada (PIN 660011)', content: 'Title chunk.\n\nBody text.' },
    });
    try {
      const s = sinks(await (await getEvent(db)).text());
      assert.match(s.speakerRow ?? '', /660011/, 'EV-X8 fixed in the speaker meta row');
      assert.match(s.jsonLd.performer.name, /660011/, 'EV-X8 fixed in JSON-LD performer.name');
      const ics = await (await getEvent(db, { query: '?add=ics' })).text();
      assert.match(ics, /660011/, 'EV-X8 fixed in the .ics export');
    } finally { db.close(); }
  });

  it('EV-X8 CLOSED for the shape the patterns DO cover: a conferencing host beside a speaker name', async () => {
    // The counterweight that makes the residual above a statement about the
    // VOCABULARY rather than about the channel. The column is genuinely on the
    // scrubber's path now: the same fixture with a Meet host instead of an
    // unrecognised label is removed from all four speaker sinks, and the row is
    // omitted rather than rendered blank.
    const db = await eventDb({
      viewer: 'anonymous',
      post: { speaker: 'Dr Ada meet.google.com/spk-aaaa-bbb', content: 'Title chunk.\n\nBody text.' },
    });
    try {
      const html = await (await getEvent(db)).text();
      const s = sinks(html);
      assert.ok(!html.includes('spk-aaaa-bbb'), 'the room reached the page through the speaker column');
      assert.equal(s.speakerRow, null, 'an emptied speaker should omit the row, not render a blank one');
      assert.equal('performer' in s.jsonLd, false);
      const ics = await (await getEvent(db, { query: '?add=ics' })).text();
      assert.ok(!ics.includes('spk-aaaa-bbb'), 'the room reached the .ics through the speaker column');
    } finally { db.close(); }
  });

  it('EV-X9 PARTIALLY CLOSED: the gcal href and the .ics SUMMARY are scrubbed now, to the same vocabulary limit', async () => {
    // Two sinks the earlier passes had not named. calDescription interpolates
    // the speaker and buildICS interpolates the title; both are handed to every
    // tier including anonymous, and both now receive the SCRUBBED values through
    // safeTitle() and the scrubbed speaker. The residual is the same one as
    // EV-X8: a mid-line label with no colon at the start of a line.
    const db = await eventDb({
      viewer: 'anonymous',
      post: { title: 'Weekly Call PIN: 313131', content: 'Title chunk.\n\nSpeaker: Dr Ada, dial 555-020-9999\n\nBody.' },
    });
    try {
      const s = sinks(await (await getEvent(db)).text());
      const gcal = decodeURIComponent((s.gcalHref ?? '').replace(/&amp;/g, '&'));
      assert.match(gcal, /555-020-9999/, 'EV-X9 fixed: the speaker no longer reaches the gcal details');
      assert.match(gcal, /313131/, 'EV-X9 fixed: the title no longer reaches the gcal text');

      const ics = await (await getEvent(db, { query: '?add=ics' })).text();
      assert.match(ics, /SUMMARY:Weekly Call PIN: 313131/, 'EV-X9 fixed: the title no longer reaches the .ics SUMMARY');
    } finally { db.close(); }
  });

  it('EV-X9 CLOSED for the shape the patterns DO cover: a Meet host in the title', async () => {
    const db = await eventDb({
      viewer: 'anonymous',
      post: {
        title: 'Weekly Call meet.google.com/ttl-aaaa-bbb',
        content: 'Fallback Chunk Title\n\nSpeaker: Dr Ada meet.google.com/spc-aaaa-bbb\n\nBody.',
      },
    });
    try {
      const html = await (await getEvent(db)).text();
      const s = sinks(html);
      assert.ok(!html.includes('ttl-aaaa-bbb'), 'the room reached the page through the title column');
      assert.ok(!html.includes('spc-aaaa-bbb'), 'the room reached the page through the content Speaker line');
      assert.equal(s.h1, 'Fallback Chunk Title', 'the emptied title did not fall through to a safe second source');
      const gcal = decodeURIComponent((s.gcalHref ?? '').replace(/&amp;/g, '&'));
      assert.ok(!gcal.includes('ttl-aaaa-bbb'));
      const ics = await (await getEvent(db, { query: '?add=ics' })).text();
      assert.ok(ics.includes('SUMMARY:Fallback Chunk Title'));
      assert.ok(!ics.includes('ttl-aaaa-bbb'));
    } finally { db.close(); }
  });

  it('og:image:alt is a fifth place the title lands, and it is scrubbed to the same limit', async () => {
    const leaked = await renderEvent({
      viewer: 'anonymous',
      post: { title: 'Weekly Call PIN: 313132', content: 'Title chunk.\n\nBody.' },
    });
    const alt = /<meta property="og:image:alt" content="([^"]*)">/.exec(leaked.html)?.[1] ?? '';
    assert.match(alt, /PIN: 313132/, 'the mid-line-label residual is closed; update the module header');

    const closed = await renderEvent({
      viewer: 'anonymous',
      post: { title: 'Weekly Call meet.google.com/alt-aaaa-bbb', content: 'Fallback Chunk Title\n\nBody.' },
    });
    const safeAlt = /<meta property="og:image:alt" content="([^"]*)">/.exec(closed.html)?.[1] ?? '';
    assert.equal(safeAlt, 'Fallback Chunk Title', 'og:image:alt is not on the guarded title path');
  });
});

// =====================================================================
// Guards -- things that hold today and must keep holding
// =====================================================================

describe('scrubJoinInfo -- repeated credentials of the same shape', () => {
  // The reconstructed regex is `new RegExp(re.source, 'gim')`. Nothing in the
  // existing suite puts two instances of the SAME pattern in one post, so
  // dropping the `g` flag -- redacting only the first occurrence -- passed every
  // test. A post listing a US and an international dial-in is the ordinary case.
  it('redacts EVERY occurrence of a pattern, not just the first', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('Dial-in: +1 555-050-1111\n\nDial-in: +44 555-050-2222\n\nPIN: 660022\n\nPIN: 660033') },
    });
    for (const needle of ['555-050-1111', '555-050-2222', '660022', '660033']) {
      assert.deepEqual(leakingSinks(r, needle), [], `a repeated credential survived: ${needle}`);
    }
    assertPageAlive(r);
  });

  it('redacts a second bare Meet host as well as the first', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('Room A meet.google.com/aaa-aaaa-aaa\n\nRoom B meet.google.com/bbb-bbbb-bbb') },
    });
    assert.deepEqual(leakingSinks(r, 'aaa-aaaa-aaa'), []);
    assert.deepEqual(leakingSinks(r, 'bbb-bbbb-bbb'), []);
    assertPageAlive(r);
  });
});

describe('the JSON-LD, attacked independently', () => {
  // JSON.stringify does NOT escape U+2028 / U+2029 -- they are legal inside a
  // JSON string and are emitted raw. That is harmless in an
  // application/ld+json data block and fatal in an inline executable script, so
  // it is worth pinning WHICH of those two this element is.
  const PAYLOADS = [
    ['U+2028 line separator', 'A\u2028B'],
    ['U+2029 paragraph separator', 'A\u2029B'],
    ['raw </script> followed by an HTML comment open', 'x</script><!--<script>alert(1)</script>'],
    ['an HTML comment close', 'x --> y <!-- z'],
    ['a CDATA close', 'x]]>y'],
    ['a pre-escaped script close', 'a<\\/script><script>alert(2)<\\/script>'],
    ['a literal \\u003c escape sequence', 'a\\u003c/script>'],
    ['a script close with an attribute', '</ScRiPt foo=bar>'],
    ['a script close with trailing space', '</script >'],
    ['a key-injection payload', '","@type":"WebSite","injected":"'],
    ['a brace-and-bracket storm', '"}}]}<script>y</script>'],
    ['CR, LF and TAB', 'a\r\nb\tc'],
    ['a backslash beside a quote', 'a"b\\c'],
  ];

  for (const [name, payload] of PAYLOADS) {
    it(`stays a data block with ${name} in the title`, async () => {
      const title = `T ${payload} T`;
      const r = await renderEvent({ viewer: 'anonymous', post: { title, content: 'T.\n\nBody.' } });

      assert.notEqual(r.jsonLdRaw, null, 'the ld+json element could not be extracted at all');
      assert.equal(r.jsonLdParseError, null, 'the ld+json element stopped being parseable JSON');
      assert.equal(r.jsonLd.name, title, 'the payload did not round-trip as data');
      assert.equal(r.jsonLd['@type'], 'Event', 'an injected key displaced @type');
      assert.equal(r.jsonLd.injected, undefined);
      assert.ok(!r.jsonLdRaw.includes('<'), 'a raw < inside ld+json can terminate the element');

      // The element must not have opened or closed a script anywhere else.
      const opens = (r.html.match(/<script/gi) || []).length;
      const closes = (r.html.match(/<\/script>/gi) || []).length;
      assert.equal(opens, closes, `script tags went unbalanced: ${opens} open, ${closes} close`);
    });
  }

  it('U+2028 and U+2029 never reach the description or the speaker, because both paths treat them as whitespace', async () => {
    // Worth pinning, because it is the reason the separators are only ever a
    // question about the TITLE. summarize() collapses them with /\s+/ (JS \s
    // includes both), and extractSpeaker's `.` cannot cross a LineTerminator,
    // so a speaker line is truncated at the separator rather than carrying it.
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'T.\n\nSpeaker: Dr A\u2028B\n\nAbout A\u2029B the topic' },
    });
    assert.equal(r.jsonLdParseError, null);
    assert.equal(r.jsonLd.description, 'Speaker: Dr A B About A B the topic');
    assert.equal(r.jsonLd.performer.name, 'Dr A', 'extractSpeaker stopped at the line separator');
    assert.ok(!r.jsonLdRaw.includes('\u2028'));
    assert.ok(!r.jsonLdRaw.includes('\u2029'));
  });

  it('the raw U+2028 really is emitted unescaped, which is why the element type matters', async () => {
    // If this ever starts failing because JSON.stringify began escaping it, the
    // reasoning above is obsolete, not wrong -- but the guard should be re-read.
    assert.equal(JSON.stringify('\u2028'), '"\u2028"');
    const r = await renderEvent({ viewer: 'anonymous', post: { title: 'A\u2028B', content: 'T.\n\nB.' } });
    assert.ok(r.jsonLdRaw.includes('\u2028'), 'the raw separator was expected inside the ld+json element');
    assert.equal(/<script type="application\/ld\+json">/.test(r.html), true,
      'the element must stay type=application/ld+json; as an executable script the raw U+2028 would be a syntax error');
  });
});

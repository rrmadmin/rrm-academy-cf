/**
 * functions/events/[slug].js -- ADVERSARIAL pass over the join-credential
 * redaction, run against the suite in events-page-redaction.test.js rather
 * than with it.
 *
 * That suite proved each of scrubJoinInfo()'s patterns redacts what it claims,
 * and reported sixteen formats that slipped past. This file is the independent
 * attack on the same code: formats devised without reference to the pattern
 * list, and -- more importantly -- SINKS THAT SUITE NEVER LOOKED AT.
 *
 * The finding that mattered most was EV-X0. redactionSinks() audits five
 * strings: the rendered body, og:description, twitter:description, the meta
 * description and the JSON-LD. og:image, twitter:image, the JSON-LD `image`
 * field and the rendered flyer <img src> are not among them, and summarize()
 * captures firstImage from the markdown BEFORE scrubJoinInfo() runs. So a
 * markdown IMAGE whose src was the Meet room published the live joining URL in
 * four places while every assertion in the existing suite passed.
 *
 * HOW TO READ THE ASSERTIONS
 * -------------------------
 * Most of the cases below have been CLOSED and are now asserted in the
 * direction they always should have been: the credential must be absent. Two
 * remain open, at the bottom, still asserted positively ("it leaked") because
 * that is what the deployed code does and pretending otherwise is how this
 * class of bug survives. Each open case says what closing it would have cost.
 *
 * The redaction now works on a label-plus-value rule -- see the header of
 * functions/events/[slug].js -- and the anti-over-redaction half of the
 * contract lives in test/events-page-over-redaction.test.js. A case here that
 * goes green by deleting prose is not a case that passed.
 *
 * No live exposure was ever found. All nineteen event rows in production were
 * checked against these formats and none contained one. These were latent.
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
  it('EV-X0 is closed: a markdown IMAGE on a conferencing host reaches none of those four sinks', async () => {
    // One "!" apart from the fully-redacted form asserted in the control below.
    // summarize() pulls the src out in the ![...](...) replace and records it as
    // firstImage, so the fix has to live at the capture, not in the scrubber:
    // the src is judged on its parsed HOST before it is allowed to become
    // firstImage at all.
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: 'Title chunk.\n\n![Join the call](https://meet.google.com/img-aaaa-bbb)\n\nSee you there.' },
    });

    assert.equal(r.response.status, 200);
    const twitterImage = /<meta name="twitter:image" content="([^"]*)">/.exec(r.html)?.[1] ?? '';
    const BRANDED = 'https://rrmacademy.org/og/save-the-uterus-club.png?v=8';

    assert.equal(r.ogImage, BRANDED, 'EV-X0 regressed in og:image');
    assert.equal(twitterImage, BRANDED, 'EV-X0 regressed in twitter:image');
    assert.equal(r.jsonLd.image, BRANDED, 'EV-X0 regressed in JSON-LD image');
    assert.equal(r.flyerSrc, null, 'EV-X0 regressed in the rendered flyer src');
    assert.ok(!r.html.includes('img-aaaa-bbb'), 'the room reached the document somewhere else');

    assert.deepEqual(leakingSinks(r, 'img-aaaa-bbb'), []);
    assert.match(r.body ?? '', /See you there\./, 'positive control: the prose must survive');
  });

  it('judges an image on its HOST, never on its filename', async () => {
    // The rule that keeps EV-X0's fix from becoming an over-redaction: these
    // filenames all contain a redaction label as an English word.
    for (const src of [
      'https://cdn.example/endo-call-2026.jpg',
      'https://cdn.example/zoom-in-on-the-ultrasound.png',
      'https://cdn.example/teams/room-101/pin-board.webp',
    ]) {
      const r = await renderEvent({
        viewer: 'anonymous',
        post: { og_image_url: null, content: `Title chunk.\n\n![flyer](${src})\n\nSee you there.` },
      });
      assert.equal(r.flyerSrc, src, `a legitimate flyer was dropped: ${src}`);
      assert.equal(r.ogImage, src);
    }
  });

  it('the same URL as a markdown LINK is fully redacted -- the control that makes EV-X0 a one-character defect', async () => {
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
 * Every case here USED to reach all five audited sinks on a page an anonymous
 * visitor sees. Grouped by the mechanism that defeated the old patterns,
 * because the fix was one decision per class, not one regex per line:
 *
 *   EV-X1  the ^ anchor  -> the label rule is no longer line-anchored.
 *   EV-X2  extra words   -> a label may carry a qualifier (number/code/id/...).
 *   EV-X3  split lines   -> the separator may cross exactly one line break.
 *   EV-X4  split host    -> a URL wrapped mid-host is rejoined before parsing.
 *   EV-X5  invisibles    -> zero-width and format characters are stripped, and
 *                           removing the anchor made most of the class moot.
 *   EV-X6  separators    -> the separator is a character class, not ":".
 *   EV-X7  host spoofing -> the host comes from parsing the URL, not from a
 *                           substring search, so percent-encoding is resolved.
 *
 * Two members of these classes are NOT closed and are asserted separately at
 * the bottom of this file, still in the positive direction.
 */
const CLOSED_LEAKS = [
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
  // Distinct from the wrapped-tail case: breaking inside the host meant NO
  // pattern fired at all, so the entire room code survived on an intact line.
  { id: 'EV-X4a', why: 'the meet.google.com host itself split across a wrap', line: 'Join at https://meet.\ngoogle.com/hst-aaaa-bbb before 6pm.', needle: 'hst-aaaa-bbb' },

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
  { id: 'EV-X7b', why: 'percent-encoded dots inside the host', line: 'Join at https://meet%2Egoogle%2Ecom/pct-aaaa-bbb today.', needle: 'pct-aaaa-bbb' },
];

describe('the independent leak hunt, closed', () => {
  for (const { id, why, line, needle } of CLOSED_LEAKS) {
    it(`${id} is redacted: ${why}`, async () => {
      const r = await renderEvent({ viewer: 'anonymous', post: { content: contentAround(line) } });
      assert.equal(r.response.status, 200);
      assert.deepEqual(
        leakingSinks(r, needle), [],
        `${id} regressed: ${JSON.stringify(needle)} reached a public sink again`
      );
      assertPageAlive(r);
    });
  }

  it('EV-X3 no longer leaves a bare credential with its own label stripped off', async () => {
    // The old behaviour was the worst shape available: the pattern deleted the
    // LABEL line and left the naked PIN behind, so a reviewer skimming the
    // published page saw a number with nothing marking it as a credential. The
    // separator now crosses one line break, so the value goes with the label.
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('PIN:\n445580') },
    });
    assert.equal(r.body, '<p>Closing paragraph, kept.</p>',
      'the whole label-and-value pair should be gone, leaving the surrounding prose');
    assert.equal(r.ogDescription, 'Closing paragraph, kept.');
    assert.ok(!r.html.includes('445580'));
  });

  it('EV-X4a: the sentence around a host-wrapped URL survives, only the URL goes', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('Join at https://meet.\ngoogle.com/hst-aaaa-bbb before 6pm.') },
    });
    assert.deepEqual(leakingSinks(r, 'hst-aaaa-bbb'), []);
    assert.match(r.body ?? '', /Join at/, 'the sentence opening was eaten with the URL');
    assert.match(r.body ?? '', /before 6pm\./, 'the sentence ending was eaten with the URL');
  });

  it('the host-wrap rejoin does not touch a URL whose rejoined host is innocent', async () => {
    // The rejoin is safe to be greedy about precisely because the replacer puts
    // the token back untouched when the resulting host is not a meeting host.
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { content: contentAround('See https://rrmacademy.\norg/library/endometriosis for the evidence.') },
    });
    assert.match(r.body ?? '', /rrmacademy/, 'an innocent wrapped URL was deleted');
    assert.match(r.body ?? '', /library\/endometriosis/);
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

describe('the channels scrubJoinInfo was not on the path of', () => {
  it('EV-X8 is closed: the community_post.speaker COLUMN is scrubbed too', async () => {
    // The other speaker finding is about a "Speaker:" line inside content. This
    // is the other arm of `event.speaker || extractSpeaker(...)`: the column
    // short-circuits extraction entirely, so scrubbing only the content arm
    // would have left this one wide open.
    const db = await eventDb({
      viewer: 'anonymous',
      post: { speaker: 'Dr Ada (PIN 660011)', content: 'Title chunk.\n\nBody text.' },
    });
    try {
      const s = sinks(await (await getEvent(db)).text());
      assert.ok(!/660011/.test(s.speakerRow ?? ''), 'EV-X8 regressed in the speaker meta row');
      assert.ok(!/660011/.test(s.jsonLd.performer.name), 'EV-X8 regressed in JSON-LD performer.name');
      const ics = await (await getEvent(db, { query: '?add=ics' })).text();
      assert.ok(!/660011/.test(ics), 'EV-X8 regressed in the .ics export');
      // ...and the speaker is still a usable name, not an empty string.
      assert.match(s.speakerRow ?? '', /Dr Ada/, 'the speaker was emptied rather than scrubbed');
    } finally { db.close(); }
  });

  it('EV-X9 is closed: the Google Calendar href and the .ics SUMMARY are clean too', async () => {
    // Two sinks the first pass never named. calDescription interpolates the
    // speaker and buildICS interpolates the title, and both are handed to
    // visitors of every tier including anonymous.
    const db = await eventDb({
      viewer: 'anonymous',
      post: { title: 'Weekly Call PIN: 313131', content: 'Title chunk.\n\nSpeaker: Dr Ada, dial 555-020-9999\n\nBody.' },
    });
    try {
      const s = sinks(await (await getEvent(db)).text());
      const gcal = decodeURIComponent((s.gcalHref ?? '').replace(/&amp;/g, '&'));
      assert.ok(!/555-020-9999/.test(gcal), 'EV-X9 regressed: the speaker reached the gcal details');
      assert.ok(!/313131/.test(gcal), 'EV-X9 regressed: the title reached the gcal text');
      assert.match(gcal, /text=Weekly Call&/, 'the gcal title was emptied rather than scrubbed');

      const ics = await (await getEvent(db, { query: '?add=ics' })).text();
      assert.ok(!/313131/.test(ics), 'EV-X9 regressed: the title reached the .ics SUMMARY');
      assert.ok(ics.includes('SUMMARY:Weekly Call'), 'the .ics title was emptied rather than scrubbed');
    } finally { db.close(); }
  });

  it('og:image:alt, the fifth place the title lands, is clean and non-empty', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { title: 'Weekly Call PIN: 313132', content: 'Title chunk.\n\nBody.' },
    });
    const alt = /<meta property="og:image:alt" content="([^"]*)">/.exec(r.html)?.[1] ?? '';
    assert.ok(!/313132/.test(alt), 'the credential reached og:image:alt');
    assert.equal(alt, 'Weekly Call', 'og:image:alt was emptied rather than scrubbed');
  });
});

// =====================================================================
// The two cases from this pass that are STILL OPEN
// =====================================================================

/**
 * Both survive because closing them costs more than they are worth, and the
 * cost is paid in clinical prose. They are asserted positively on purpose. If
 * one goes red the residual is closed: move it into CLOSED_LEAKS and say which
 * rule did it -- but not by loosening the label-plus-value rule.
 */
const OPEN_RESIDUALS = [
  {
    id: 'EV-X4b',
    why: 'markdown emphasis inside the host (meet.**google**.com)',
    cost: 'the host would have to be matched against a copy with markdown stripped, '
      + 'and every character removed from that copy shifts the offsets used to '
      + 'redact the original -- the mapping is where this class of bug is born',
    line: 'Join at meet.**google**.com/bld-aaaa-bbb today.',
    needle: 'bld-aaaa-bbb',
  },
  {
    id: 'EV-X7a',
    why: 'a Cyrillic homoglyph inside the host (googlе.com with U+0435)',
    cost: 'this needs a confusables table, not a denylist; the URL parses to a '
      + 'genuinely different host and no amount of host-list tuning reaches it',
    line: 'Join at https://meet.googlе.com/cyr-aaaa-bbb today.',
    needle: 'cyr-aaaa-bbb',
  },
];

describe('open residuals from the adversarial pass', () => {
  for (const { id, why, cost, line, needle } of OPEN_RESIDUALS) {
    it(`LEAKS ${id}: ${why}`, async () => {
      const r = await renderEvent({ viewer: 'anonymous', post: { content: contentAround(line) } });
      assert.equal(r.response.status, 200);
      assert.deepEqual(
        leakingSinks(r, needle), ALL_FIVE,
        `${id} no longer reaches every public sink. If ${JSON.stringify(needle)} is now redacted, `
        + `the residual is CLOSED: move it into CLOSED_LEAKS. It was left open because: ${cost}.`
      );
      assertPageAlive(r);
    });
  }
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

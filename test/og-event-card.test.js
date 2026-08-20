/**
 * The Save the Uterus Club EVENT card served by functions/og/[[path]].js at the
 * runtime slug `events-<slug>`.
 *
 * WHY THE ANALYTICS-ENGINE LABEL IS ASSERTED, NOT JUST THE RESPONSE
 * ----------------------------------------------------------------
 * Every path through this endpoint returns 200 image/png -- that is the whole
 * design (defences B1-B7: an unknown slug gets a branded card, never a 404 and
 * never a 500). Which means a test that asserts only on the response cannot
 * tell an event card from the fallback card, and would stay green if the event
 * branch were deleted outright. Two independent signals are therefore asserted
 * everywhere it matters: the AE status label, which names the branch the
 * handler took, and the satori TREE, which carries the copy that branch built.
 *
 * WHAT THE DATABASE IS
 * --------------------
 * The real committed DDL, via test/_event-page-fixtures.mjs -> _d1-sqlite.mjs,
 * including migrations/032-free-events.sql for community_post.is_free. The
 * endpoint's SELECT names channel, type, slug and is_free, so a hand-written
 * stub could satisfy the query while production's table refused it.
 *
 * WHAT THIS FILE CANNOT PROVE
 * ---------------------------
 * That the captured tree RASTERISES without clipping. satori and resvg are
 * stubbed out (test/_workers-og-stub.mjs explains why they have to be). Layout
 * was verified by rendering these exact builders through satori + resvg
 * locally, per the CLAUDE.md preview recipe, before the code was committed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { og, renders, resetRenders, renderOg, textOf, nodesOf } from './_og-fixtures.mjs';
import { eventDb } from './_event-page-fixtures.mjs';

const { buildEventTree, formatEventDate } = og;

/** The eyebrow, verbatim. Pinned so the club name cannot be abbreviated away. */
const EYEBROW = 'SAVE THE UTERUS CLUB · LIVE EVENT';
const FREE_CHIP = 'FREE · OPEN TO EVERYONE';
const MEMBERS_CHIP = 'MEMBERS-ONLY LIVE CALL';

/** A fixed instant, so the printed date line is the same in every time zone. */
const AUG_24_8PM_ET = '2026-08-25T00:00:00.000Z';

/** Renders `/og/events-<slug>.png` against a seeded database. */
async function renderEventCard(post = {}, { slug = 'events-endo-excision-call', env = {} } = {}) {
  resetRenders();
  const db = await eventDb({ post });
  try {
    const result = await renderOg(`${slug}.png`, { env: { DB: db, ...env } });
    return { ...result, tree: renders.at(-1)?.tree ?? null, text: textOf(renders.at(-1)?.tree ?? null) };
  } finally {
    db.close();
  }
}

describe('the event card is reached, and only by an events- slug that resolves', () => {
  it('a real event slug takes the event branch and prints the club eyebrow', async () => {
    const r = await renderEventCard({ event_date: AUG_24_8PM_ET, speaker: 'Rebecca Vavilov', is_free: 1 });

    assert.equal(r.status, 200);
    assert.equal(r.contentType, 'image/png');
    assert.equal(r.statusLabel, 'event_hit', 'the handler did not take the event branch');
    assert.ok(r.text.includes(EYEBROW), `eyebrow missing from ${JSON.stringify(r.text)}`);
  });

  it('an events- slug with no matching row falls back, and the fallback is a DIFFERENT card', async () => {
    // The second half is what makes the first half mean something: if the
    // fallback card happened to carry the same copy, "fell back" would be
    // indistinguishable from "rendered the event".
    const r = await renderEventCard({}, { slug: 'events-no-such-event-exists' });

    assert.equal(r.status, 200);
    assert.equal(r.contentType, 'image/png');
    assert.equal(r.statusLabel, 'fallback');
    assert.ok(!r.text.includes(EYEBROW), 'the fallback card printed the event eyebrow');
    assert.ok(
      r.text.some((s) => s.includes('Evidence-based education in Restorative Reproductive Medicine.')),
      `expected the branded fallback copy, got ${JSON.stringify(r.text)}`
    );
  });

  it('a malformed events- slug never reaches D1 at all', async () => {
    // The regex is the gate. If it ever loosened, these would reach the bind
    // and this test would still pass on the response alone -- hence the spy.
    for (const slug of ['events-bad!slug', 'events-', 'events-a/../b', 'events-' + 'x'.repeat(140)]) {
      let queried = false;
      const db = await eventDb({
        interleave: ({ sql }) => { if (sql.includes('community_post')) queried = true; },
      });
      try {
        resetRenders();
        const r = await renderOg(`${slug}.png`, { env: { DB: db } });
        assert.equal(r.status, 200, `${slug} did not return an image`);
        assert.equal(r.statusLabel, 'fallback', `${slug} was treated as an event`);
        assert.equal(queried, false, `${slug} reached D1`);
      } finally {
        db.close();
      }
    }
  });

  it('the slug match is case-insensitive, because community_post.slug is COLLATE NOCASE', async () => {
    const r = await renderEventCard({ slug: 'endo-excision-call' }, { slug: 'events-ENDO-Excision-Call' });
    assert.equal(r.statusLabel, 'event_hit');
  });

  it('a post in another channel, or of another type, is not an event card', async () => {
    for (const post of [{ channel: 'general' }, { type: 'post' }]) {
      const r = await renderEventCard(post);
      assert.equal(r.statusLabel, 'fallback', `${JSON.stringify(post)} was published as an event card`);
    }
  });

  it('no DB binding falls back instead of throwing', async () => {
    resetRenders();
    const r = await renderOg('events-endo-excision-call.png');
    assert.equal(r.status, 200);
    assert.equal(r.statusLabel, 'fallback');
  });

  it('a D1 failure falls back instead of throwing -- same posture as lookupAsk', async () => {
    const db = await eventDb({
      interleave: ({ sql }) => {
        if (sql.includes('community_post')) throw new Error('D1_ERROR: simulated');
      },
    });
    try {
      resetRenders();
      const r = await renderOg('events-endo-excision-call.png', { env: { DB: db } });
      assert.equal(r.status, 200);
      assert.equal(r.contentType, 'image/png');
      assert.equal(r.statusLabel, 'fallback');
    } finally {
      db.close();
    }
  });

  it('the card is cached for a day, like every other card on this endpoint', async () => {
    const r = await renderEventCard({ is_free: 1 });
    assert.equal(r.cacheControl, 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800');
  });
});

describe('the access chip says which door the reader is standing at', () => {
  it('is_free = 1 prints the free chip and not the members chip', async () => {
    const r = await renderEventCard({ is_free: 1 });
    assert.ok(r.text.includes(FREE_CHIP), `expected the free chip in ${JSON.stringify(r.text)}`);
    assert.ok(!r.text.includes(MEMBERS_CHIP));
  });

  it('is_free = 0 prints the members chip', async () => {
    const r = await renderEventCard({ is_free: 0 });
    assert.ok(r.text.includes(MEMBERS_CHIP), `expected the members chip in ${JSON.stringify(r.text)}`);
    assert.ok(!r.text.includes(FREE_CHIP));
  });

  it('anything not affirmatively free is members-only, matching isFreeEvent() on the page', async () => {
    // The safe default. A stray string or a 2 must not open the card up.
    // NULL is not in this list because migrations/032-free-events.sql declares
    // the column NOT NULL and the insert is refused -- the database already
    // holds that case, so asserting it here would be asserting the fixture.
    for (const is_free of [2, 'yes', '']) {
      const r = await renderEventCard({ is_free });
      assert.ok(r.text.includes(MEMBERS_CHIP), `is_free=${JSON.stringify(is_free)} printed a free chip`);
    }
  });

  it('the two chips carry the brand badge token pairs, not invented colours', async () => {
    const chipBg = async (post) => {
      const r = await renderEventCard(post);
      const pill = nodesOf(r.tree).find((n) => String(n.props?.style?.borderRadius) === '999px');
      return [pill?.props?.style?.backgroundColor, pill?.props?.style?.color];
    };
    assert.deepEqual(await chipBg({ is_free: 1 }), ['#e8f5e9', '#2e7d32'], 'free chip lost the green token pair');
    assert.deepEqual(await chipBg({ is_free: 0 }), ['#fef3c7', '#b45309'], 'members chip lost the amber token pair');
  });
});

describe('the lines the card prints, and the ones it drops', () => {
  it('prints the date as "Monday, August 24 · 8:00 PM Eastern", in Eastern time', async () => {
    const r = await renderEventCard({ event_date: AUG_24_8PM_ET, is_free: 1 });
    assert.ok(r.text.includes('Monday, August 24 · 8:00 PM Eastern'),
      `date line missing or reformatted: ${JSON.stringify(r.text)}`);
  });

  it('formatEventDate is Eastern regardless of the machine, and empty on an unparseable date', () => {
    // Directly, so the timezone claim is proven rather than inherited from
    // whatever TZ the test runner happens to be in.
    assert.equal(formatEventDate('2026-08-25T00:00:00.000Z'), 'Monday, August 24 · 8:00 PM Eastern');
    assert.equal(formatEventDate('2026-01-15T18:30:00.000Z'), 'Thursday, January 15 · 1:30 PM Eastern');
    // `new Date(null)` is the Unix EPOCH, not an invalid date, so a null column
    // printed a real-looking "Wednesday, December 31" line until the type check
    // went in. That case is the reason this loop exists.
    for (const bad of ['', '   ', null, undefined, 0, 'not-a-date', 'Tuesday']) {
      assert.equal(formatEventDate(bad), '', `${JSON.stringify(bad)} produced a date line`);
    }
  });

  it('drops the date line entirely rather than printing "Invalid Date"', async () => {
    const r = await renderEventCard({ event_date: 'whenever', is_free: 1 });
    assert.equal(r.statusLabel, 'event_hit');
    assert.ok(!r.text.some((s) => s.includes('Invalid Date')), 'the card printed Invalid Date');
    assert.ok(r.text.includes(EYEBROW), 'the card did not render at all');
  });

  it('prints "With <speaker>" when there is one, and no such line when there is not', async () => {
    const withSpeaker = await renderEventCard({ speaker: 'Rebecca Vavilov', is_free: 1 });
    assert.ok(withSpeaker.text.includes('With Rebecca Vavilov'));

    for (const speaker of [null, '']) {
      const without = await renderEventCard({ speaker, is_free: 1 });
      assert.ok(!without.text.some((s) => s.startsWith('With ')),
        `speaker ${JSON.stringify(speaker)} still produced a With line`);
    }
  });

  it('features the Cuterus mascot, the same inlined image the club card uses', async () => {
    const r = await renderEventCard({ is_free: 1 });
    const img = nodesOf(r.tree).find((n) => n.type === 'img');
    assert.ok(img, 'the mascot is missing from the event card');
    assert.match(String(img.props.src), /^data:image\/jpeg;base64,/);
  });

  it('renders at exactly 1200x630, the size the page now declares', async () => {
    const r = await renderEventCard({ is_free: 1 });
    assert.equal(renders.at(-1).options.width, 1200);
    assert.equal(renders.at(-1).options.height, 630);
    assert.equal(r.tree.props.style.width, '1200px');
    assert.equal(r.tree.props.style.height, '630px');
  });
});

describe('the copy on the card obeys the house rules', () => {
  it('spells Save the Uterus Club in full and uses no em dash anywhere', async () => {
    for (const post of [{ is_free: 1, speaker: 'Rebecca Vavilov' }, { is_free: 0, speaker: null }]) {
      const r = await renderEventCard({ event_date: AUG_24_8PM_ET, ...post });
      const copy = r.text.join(' | ');
      assert.ok(copy.includes('SAVE THE UTERUS CLUB'), `club name abbreviated in ${copy}`);
      assert.ok(!copy.includes('—'), `em dash in card copy: ${copy}`);
      assert.ok(!copy.includes('STUC'), `internal abbreviation reached the card: ${copy}`);
    }
  });

  it('clamps a very long title instead of letting it run past the mascot', async () => {
    const long = 'Restorative Reproductive Medicine for Recurrent Miscarriage: '.repeat(6);
    const r = await renderEventCard({ title: long, is_free: 1 });
    const rendered = r.text.find((s) => s.startsWith('Restorative Reproductive'));
    assert.ok(rendered, 'the title vanished');
    assert.ok([...rendered].length <= 90, `title was ${[...rendered].length} codepoints, expected <= 90`);
    assert.ok(rendered.endsWith('…'), 'a clamped title should say so with an ellipsis');
  });

  it('a row with a blank title still renders a card rather than a blank one', async () => {
    // NOT NULL on community_post.title, so '' is the emptiest a row can be.
    const r = await renderEventCard({ title: '', is_free: 1 });
    assert.equal(r.statusLabel, 'event_hit');
    assert.ok(r.text.includes('Save the Uterus Club Live Event'));
  });
});

describe('buildEventTree, directly', () => {
  it('sizes the title down as it gets longer, so a long one still fits the column', () => {
    const size = (title) => {
      const tree = buildEventTree({ title, dateLine: '', speaker: '', isFree: true });
      return textOf(tree).includes(title)
        ? nodesOf(tree).find((n) => n.props?.children === title).props.style.fontSize
        : null;
    };
    const sizes = ['Short one', 'A'.repeat(40), 'A'.repeat(70), 'A'.repeat(88)].map(size);
    assert.deepEqual(sizes, ['68px', '58px', '48px', '42px']);
  });

  it('always ends with the shared brand band, so the card is recognisably ours', () => {
    const tree = buildEventTree({ title: 'X', dateLine: '', speaker: '', isFree: false });
    const text = textOf(tree);
    assert.ok(text.includes('RRM Academy'));
    assert.ok(text.includes('rrmacademy.org'));
  });
});

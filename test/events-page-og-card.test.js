/**
 * The social-card metas on the public event page (functions/events/[slug].js).
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * og:image and twitter:image used to be the event FLYER: a 1080x1080 WEBP in
 * R2. Two scrapers made that a broken share rather than a stylistic one --
 * Facebook and WhatsApp reject webp outright, so the share rendered with no
 * image at all, and X's summary_large_image crops a square to 1.91:1 from the
 * centre, which takes the headline off the top. Both metas now point at the
 * site's own renderer, /og/events-<slug>.png, which serves a branded 1200x630
 * PNG built from the same D1 row.
 *
 * THE SPLIT IS DELIBERATE, AND IT IS THE THING THIS FILE PINS
 * ----------------------------------------------------------
 * The flyer keeps every other job: it is still the page HERO and still the
 * JSON-LD `image`, where a square is correct and the format restrictions above
 * do not apply. So this file asserts, separately, that the card is in the two
 * social metas AND that the flyer is still in the two places it belongs. A test
 * that only checked the metas would stay green if this change had quietly
 * deleted the hero.
 *
 * The redaction guarantees are NOT re-proven here -- events-page-redaction,
 * -over-redaction and -adversarial own those, and they now assert against the
 * card URL where they used to assert against the branded fallback flyer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderEvent } from './_event-page-fixtures.mjs';

/** Mirrors OG_VERSION in src/lib/og-config.ts, which the page inlines. */
const OG_VERSION = 'v8';
const CARD = `https://rrmacademy.org/og/events-endo-excision-call.png?v=${OG_VERSION}`;
const FLYER = 'https://cdn.example/august-call-flyer.webp';

const meta = (html, re) => re.exec(html)?.[1] ?? null;
const ogImageWidth = (h) => meta(h, /<meta property="og:image:width" content="([^"]*)">/);
const ogImageHeight = (h) => meta(h, /<meta property="og:image:height" content="([^"]*)">/);
const ogImageType = (h) => meta(h, /<meta property="og:image:type" content="([^"]*)">/);
const twitterImage = (h) => meta(h, /<meta name="twitter:image" content="([^"]*)">/);

describe('og:image and twitter:image are the rendered card, not the flyer', () => {
  it('both metas point at /og/events-<slug>.png with the cache-busting version', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { og_image_url: FLYER, content: 'Title.\n\nBody.' } });

    assert.equal(r.response.status, 200);
    assert.equal(r.ogImage, CARD);
    assert.equal(twitterImage(r.html), CARD);
    assert.match(r.ogImage, /^https:\/\/rrmacademy\.org\/og\/events-[a-z0-9-]+\.png\?v=/);
  });

  it('the raw flyer URL is gone from BOTH social metas', async () => {
    // The whole point of the change: a webp in og:image is an empty share on
    // Facebook and WhatsApp. Asserting equality above would still pass if the
    // flyer were appended somewhere in the same attribute, so absence is
    // asserted on its own.
    const r = await renderEvent({ viewer: 'anonymous', post: { og_image_url: FLYER, content: 'Title.\n\nBody.' } });

    assert.ok(!r.ogImage.includes(FLYER), `the flyer is still in og:image: ${r.ogImage}`);
    assert.ok(!String(twitterImage(r.html)).includes(FLYER), 'the flyer is still in twitter:image');
    assert.ok(!r.ogImage.endsWith('.webp'), 'og:image is still a webp');
  });

  it('declares the card dimensions and type, so a scraper does not have to fetch to find out', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { og_image_url: FLYER, content: 'Title.\n\nBody.' } });

    assert.equal(ogImageWidth(r.html), '1200');
    assert.equal(ogImageHeight(r.html), '630');
    assert.equal(ogImageType(r.html), 'image/png');
  });

  it('every event gets its own card URL, so one cached unfurl cannot serve another event', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { slug: 'charting-after-birth-control', content: 'Title.\n\nBody.' },
      slug: 'charting-after-birth-control',
    });
    assert.equal(r.ogImage, `https://rrmacademy.org/og/events-charting-after-birth-control.png?v=${OG_VERSION}`);
  });

  it('a free event and a members event share the URL SHAPE -- the card differentiates itself server-side', async () => {
    // The access chip is decided by the renderer reading is_free out of the same
    // row, not by the page passing a flag through the URL. Pinned because
    // encoding it in the query string would put an untrusted-looking parameter
    // on a cacheable image endpoint for no gain.
    const free = await renderEvent({ viewer: 'anonymous', post: { is_free: 1, content: 'T.\n\nB.' } });
    const members = await renderEvent({ viewer: 'anonymous', post: { is_free: 0, content: 'T.\n\nB.' } });
    assert.equal(free.ogImage, CARD);
    assert.equal(members.ogImage, CARD);
  });

  it('the card URL does not change with the visitor tier', async () => {
    // og:* is scraped by an anonymous crawler, so a member-only variant would be
    // unreachable anyway -- but a Vary:Cookie page emitting tier-dependent
    // og:image would poison whichever copy the edge cached first.
    for (const viewer of ['anonymous', 'authenticated', 'member', 'staff']) {
      const r = await renderEvent({ viewer, post: { og_image_url: FLYER, content: 'T.\n\nB.' } });
      assert.equal(r.ogImage, CARD, `og:image differed for ${viewer}`);
    }
  });
});

describe('the flyer keeps the jobs the card did not take', () => {
  it('the page HERO still renders the flyer from og_image_url', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { og_image_url: FLYER, content: 'Title.\n\nBody.' } });
    assert.equal(r.flyerSrc, FLYER, 'the hero flyer was collateral damage of the meta change');
  });

  it('a markdown flyer in the content is still promoted to the hero', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { og_image_url: null, content: `Title.\n\n![flyer](${FLYER})\n\nBody.` },
    });
    assert.equal(r.flyerSrc, FLYER);
  });

  it('the JSON-LD image is still the flyer, where a square is the right shape', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { og_image_url: FLYER, content: 'Title.\n\nBody.' } });
    assert.equal(r.jsonLd.image, FLYER);
  });

  it('og:image:alt is still the event title, not the file name', async () => {
    const r = await renderEvent({
      viewer: 'anonymous',
      post: { title: 'Endometriosis Excision, Start to Finish', og_image_url: FLYER, content: 'T.\n\nB.' },
    });
    assert.equal(meta(r.html, /<meta property="og:image:alt" content="([^"]*)">/),
      'Endometriosis Excision, Start to Finish');
  });
});

describe('nothing else on the page moved', () => {
  it('the .ics download is untouched by the meta change', async () => {
    const r = await renderEvent({ viewer: 'anonymous', query: '?add=ics', post: { content: 'T.\n\nB.' } });
    assert.equal(r.response.status, 200);
    assert.equal(r.response.headers.get('Content-Type'), 'text/calendar; charset=utf-8');
    assert.ok(!r.html.includes('/og/events-'), 'the card URL leaked into the calendar entry');
  });

  it('the add-to-calendar links and the canonical are unchanged', async () => {
    const r = await renderEvent({ viewer: 'anonymous', post: { content: 'T.\n\nB.' } });
    assert.equal(r.canonical, 'https://rrmacademy.org/events/endo-excision-call');
    assert.equal(r.icsHref, '/events/endo-excision-call/?add=ics');
    assert.match(String(r.gcalHref), /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  });
});

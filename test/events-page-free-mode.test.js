/**
 * functions/events/[slug].js -- FREE-EVENT MODE.
 *
 * WHAT CHANGED, AND WHAT DELIBERATELY DID NOT
 * -------------------------------------------
 * A free event lets an anonymous visitor register by email and receive the
 * joining link in a message. The thing that makes that safe is what did NOT
 * change: the page body for a non-member is still the SCRUBBED chunks, and
 * og:description, twitter:description, the meta description and the JSON-LD are
 * built from that same scrubbed summary regardless of visitor or of is_free.
 * The credential leaves the gate in exactly one place, and it is not this file's
 * output.
 *
 * So the central assertion here is a NEGATIVE one, asserted per sink rather than
 * over a concatenation (the reason is in test/events-page-redaction.test.js and
 * has not changed): on a free event, an anonymous visitor gets a registration
 * form AND no Meet URL, no dial-in and no PIN anywhere.
 *
 * THE FOUR CASES THE FLAG CREATES
 *   free + anonymous  -> registration form, no credential
 *   free + member     -> unchanged: inline Join Call, credential in the body
 *   free + past       -> unchanged: members-only recording CTA, no form
 *   not free          -> unchanged in every tier (held by the three sibling
 *                        suites, and re-asserted here for the form's absence)
 *
 * The membership gate is the real requireMember reached through a real session
 * row, exactly as in _event-page-fixtures.mjs. Nothing here is stubbed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderEvent, redactionSinks, appearsIn, FUTURE_DATE, PAST_DATE,
} from './_event-page-fixtures.mjs';

/** The default fixture's event_link. Never permitted on the page for a non-member. */
const MEET_URL = 'https://meet.google.com/gat-eded-xyz';
const DIAL = 'Phone: +1 555-020-1111';
const PIN = 'PIN: 445566';

/** A body carrying every credential shape the scrubber knows, plus real prose. */
const CONTENT_WITH_CREDENTIALS = [
  'Endometriosis Excision, Start to Finish',
  'A live walkthrough of a full excision case, with time for questions.',
  `Google Meet link: ${MEET_URL}`,
  DIAL,
  PIN,
].join('\n\n');

const FREE_UPCOMING = {
  is_free: 1,
  event_date: FUTURE_DATE,
  content: CONTENT_WITH_CREDENTIALS,
};

describe('/events/<slug> -- free event, anonymous visitor', () => {
  it('renders the registration form, targeted at this event', async () => {
    const s = await renderEvent({ post: FREE_UPCOMING, viewer: 'anonymous' });

    assert.equal(s.response.status, 200);
    assert.equal(s.regSlug, 'endo-excision-call', 'the form must POST for THIS event');
    assert.equal(s.regButtonLabel, 'Send me the link');
    assert.match(s.html, /action="\/api\/events\/register"|\/api\/events\/register/);
    assert.match(
      s.ctaNote,
      /free and open to everyone/,
      'the note must say the call is free, or nobody knows why there is a form',
    );
  });

  it('carries the honeypot and an invisible Turnstile container', async () => {
    const { html } = await renderEvent({ post: FREE_UPCOMING, viewer: 'anonymous' });
    assert.match(html, /<input class="reg__hp" type="text" name="website"[^>]*aria-hidden="true">/);
    assert.match(html, /data-reg-turnstile/);
    assert.match(html, /size: "invisible"/);
  });

  it('leaks NO joining credential into ANY sink', async () => {
    const s = await renderEvent({ post: FREE_UPCOMING, viewer: 'anonymous' });

    for (const [name, value] of redactionSinks(s)) {
      for (const [label, needle] of [['Meet URL', MEET_URL], ['dial-in', DIAL], ['PIN', PIN]]) {
        assert.ok(
          !appearsIn(value, needle),
          `free-event mode must not publish the ${label} to ${name}; free changes the CTA, never the body`,
        );
      }
    }
    // The whole document, as a backstop against a sink this suite has not named.
    assert.ok(!s.html.includes(MEET_URL), 'the Meet URL must not appear anywhere in the page');
  });

  it('keeps the real prose that sits beside the credentials', async () => {
    const { body } = await renderEvent({ post: FREE_UPCOMING, viewer: 'anonymous' });
    assert.match(body, /A live walkthrough of a full excision case/);
  });

  it('keeps the add-to-calendar block, which never carried the link anyway', async () => {
    const s = await renderEvent({ post: FREE_UPCOMING, viewer: 'anonymous' });
    assert.ok(s.gcalHref, 'Google calendar link must survive the CTA swap');
    assert.equal(s.icsHref, '/events/endo-excision-call/?add=ics');
    assert.ok(!s.gcalHref.includes('meet.google.com'));
  });

  it('marks the offer isAccessibleForFree in the JSON-LD', async () => {
    const { jsonLd } = await renderEvent({ post: FREE_UPCOMING, viewer: 'anonymous' });
    assert.equal(jsonLd.offers.isAccessibleForFree, true);
    assert.equal(
      jsonLd.location.url,
      'https://rrmacademy.org/events/endo-excision-call',
      'location must still be the public page, never the room',
    );
  });

  it('offers the two-button CTA to nobody on this page (the buttons are replaced)', async () => {
    const s = await renderEvent({ post: FREE_UPCOMING, viewer: 'anonymous' });
    assert.equal(s.ctaPrimary, null, 'the primary button is replaced by the form');
    assert.match(s.html, /See all events/, 'the secondary route out must survive as a link');
  });
});

describe('/events/<slug> -- free event, signed-in non-member', () => {
  it('gets the same registration form as an anonymous visitor', async () => {
    const s = await renderEvent({ post: FREE_UPCOMING, viewer: 'authenticated' });
    assert.equal(s.regSlug, 'endo-excision-call');
    for (const [name, value] of redactionSinks(s)) {
      assert.ok(!appearsIn(value, MEET_URL), `no Meet URL in ${name}`);
    }
  });
});

describe('/events/<slug> -- free event, member and staff', () => {
  for (const viewer of ['member', 'staff']) {
    it(`${viewer} still gets Join Call inline, not the form`, async () => {
      const s = await renderEvent({ post: FREE_UPCOMING, viewer });

      assert.equal(s.regSlug, null, 'a member must not be asked to register by email');
      assert.equal(s.ctaPrimaryLabel, 'Join Call');
      assert.equal(s.ctaPrimary, MEET_URL, 'the member CTA is the room itself');
      assert.ok(s.body.includes(MEET_URL), 'the member body is the unscrubbed content');
    });

    it(`${viewer} still gets a SCRUBBED og:description and JSON-LD`, async () => {
      const s = await renderEvent({ post: FREE_UPCOMING, viewer });
      // The member BODY diverging from the shared meta is the whole point of the
      // isMember branch; a cached og:description is served to everyone.
      assert.ok(!appearsIn(s.ogDescription ?? '', MEET_URL));
      assert.ok(!appearsIn(s.jsonLdRaw ?? '', MEET_URL));
    });
  }
});

describe('/events/<slug> -- free event that has already happened', () => {
  const FREE_PAST = { is_free: 1, event_date: PAST_DATE, content: CONTENT_WITH_CREDENTIALS };

  it('shows the members-only recording CTA and NO form', async () => {
    const s = await renderEvent({ post: FREE_PAST, viewer: 'anonymous' });

    assert.equal(s.regSlug, null, 'registration must close when the call is over');
    assert.equal(s.ctaPrimaryLabel, 'Join Save the Uterus Club to Watch');
    assert.match(s.ctaNote, /This event has ended/);
  });

  it('shows a signed-in non-member the same ended CTA', async () => {
    const s = await renderEvent({ post: FREE_PAST, viewer: 'authenticated' });
    assert.equal(s.regSlug, null);
    assert.match(s.ctaNote, /This event has ended/);
  });

  it('shows a member the archive CTA, unchanged', async () => {
    const s = await renderEvent({ post: FREE_PAST, viewer: 'member' });
    assert.equal(s.regSlug, null);
    assert.equal(s.ctaPrimaryLabel, 'See member archive');
  });
});

describe('/events/<slug> -- a members-only event is untouched by the flag', () => {
  const MEMBERS_ONLY = { event_date: FUTURE_DATE, content: CONTENT_WITH_CREDENTIALS };

  it('anonymous gets the join-the-club CTA and no form', async () => {
    const s = await renderEvent({ post: MEMBERS_ONLY, viewer: 'anonymous' });

    assert.equal(s.regSlug, null, 'no email capture on a members-only event');
    assert.equal(s.ctaPrimaryLabel, 'Join Save the Uterus Club to Watch');
    assert.equal(s.ctaPrimary, 'https://rrmacademy.org/save-the-uterus-club');
  });

  it('the JSON-LD offer does NOT claim free access', async () => {
    const { jsonLd } = await renderEvent({ post: MEMBERS_ONLY, viewer: 'anonymous' });
    assert.equal(jsonLd.offers.isAccessibleForFree, undefined);
  });

  /**
   * is_free is what opens the email channel, so anything that is not
   * affirmatively 1/true must land on the members-only path. These are the
   * values a column read can realistically produce; a truthy-string reading of
   * "0" would flip the page open, which is why the predicate is an equality set
   * rather than a truthiness test.
   */
  it('NULL is not a reachable state: the column is NOT NULL DEFAULT 0', async () => {
    await assert.rejects(
      () => renderEvent({ post: { is_free: null, event_date: FUTURE_DATE }, viewer: 'anonymous' }),
      /NOT NULL/i,
      'if this ever stops throwing, add null back to the value sweep below',
    );
  });

  for (const value of [0, '0', 'false', 2, '']) {
    it(`is_free = ${JSON.stringify(value)} stays members-only`, async () => {
      const s = await renderEvent({
        post: { is_free: value, event_date: FUTURE_DATE, content: CONTENT_WITH_CREDENTIALS },
        viewer: 'anonymous',
      });
      assert.equal(s.regSlug, null);
      assert.equal(s.ctaPrimaryLabel, 'Join Save the Uterus Club to Watch');
    });
  }
});

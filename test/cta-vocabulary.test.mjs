/**
 * Unit tests for scripts/lib/cta-vocabulary.mjs.
 * Run with: node --test test/cta-vocabulary.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CTA_ID_REGEX, CTA_ID_MAX_LENGTH, validateCtaId, isValidCtaId, loadCtaVocabulary } from '../scripts/lib/cta-vocabulary.mjs';

describe('cta-vocabulary -- CTA_ID_REGEX', () => {
  it('accepts a well-formed three-token id', () => {
    assert.match('donate.tiers.join-stuc-member', CTA_ID_REGEX);
  });
  it('rejects fewer than three tokens', () => {
    assert.doesNotMatch('donate.tiers', CTA_ID_REGEX);
  });
  it('rejects uppercase', () => {
    assert.doesNotMatch('Donate.tiers.donate', CTA_ID_REGEX);
  });
  it('rejects underscores', () => {
    assert.doesNotMatch('donate.tiers.join_stuc_member', CTA_ID_REGEX);
  });
});

describe('cta-vocabulary -- validateCtaId', () => {
  it('passes a real vocabulary id', () => {
    assert.deepEqual(validateCtaId('donate.tiers.join-stuc-member'), { ok: true });
  });
  it('passes the waitlist intent', () => {
    assert.deepEqual(validateCtaId('course.modal.waitlist'), { ok: true });
  });
  it('fails on an unknown page token', () => {
    const r = validateCtaId('checkout.tiers.donate');
    assert.equal(r.ok, false);
    assert.match(r.reason, /page token "checkout"/);
  });
  it('fails on an unknown zone token', () => {
    const r = validateCtaId('donate.banner.donate');
    assert.equal(r.ok, false);
    assert.match(r.reason, /zone token "banner"/);
  });
  it('fails on an unknown intent token', () => {
    const r = validateCtaId('donate.tiers.subscribe-now');
    assert.equal(r.ok, false);
    assert.match(r.reason, /intent token "subscribe-now"/);
  });
  it('fails over the 64-char cap even when every token is otherwise valid', () => {
    const longButValidShape = `home.hero.${'learn-'.repeat(12)}home`;
    assert.ok(longButValidShape.length > CTA_ID_MAX_LENGTH);
    const r = validateCtaId(longButValidShape);
    assert.equal(r.ok, false);
    assert.match(r.reason, /exceeds the 64-char cap/);
  });
  it('isValidCtaId is a boolean-only wrapper', () => {
    assert.equal(isValidCtaId('donate.tiers.join-stuc-member'), true);
    assert.equal(isValidCtaId('donate.tiers.subscribe-now'), false);
  });
});

describe('cta-vocabulary -- loadCtaVocabulary', () => {
  it('loads three non-empty Sets', () => {
    const vocab = loadCtaVocabulary();
    assert.ok(vocab.pages.size > 0);
    assert.ok(vocab.zones.size > 0);
    assert.ok(vocab.intents.size > 0);
    assert.ok(vocab.zones.has('footer-col-1'));
    assert.ok(vocab.zones.has('footer-col-4'));
    assert.ok(vocab.pages.has('nav-mobile'));
    assert.ok(vocab.intents.has('retry'));
    assert.ok(vocab.intents.has('waitlist'));
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFaqAnswers } from './faq-no-affirmative-lead.mjs';

test('clean FAQ passes', () => {
  const html = `<div class="prose">In many cases, yes. But the evidence shows...</div>
  <div class="faq-answer"><p>No, that is a misconception.</p></div>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, true);
});

test('Yes lead fails', () => {
  const html = `<div class="faq-answer"><p>Yes, in many cases the workup helps.</p></div>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
  assert.match(r.error, /Yes/);
});

test('Absolutely lead fails', () => {
  const html = `<div class="prose"><p>Absolutely, the data supports this.</p></div>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
});

test('lead inside nested tags fails (HTML-aware)', () => {
  const html = `<div class="faq-answer"><p><strong>Of course, the workup...</strong></p></div>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
  assert.match(r.error, /Of course/);
});

test('lead with leading whitespace fails', () => {
  const html = `<div class="faq-answer">   <p>Yes, this works.</p></div>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
});

test('case-insensitive: yes lowercase fails', () => {
  const html = `<div class="prose"><p>yes, this is fine.</p></div>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
});

test('No lead is permitted (different risk class)', () => {
  const html = `<div class="faq-answer"><p>No, that is not accurate.</p></div>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, true);
});

test('heading precedes answer paragraph, banned lead still caught', () => {
  const html = `<div class="prose"><h3>Does X help?</h3><p>Yes, in many cases it helps.</p></div>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
  assert.match(r.error, /Yes/);
});

test('multiple headings precede answer paragraph, banned lead still caught', () => {
  const html = `<div class="prose"><h2>Section</h2><h3>Does X help?</h3><p>Correct, it helps.</p></div>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
  assert.match(r.error, /Correct/);
});

test('non-dd content (structured dl/dd card) is ignored, not scanned', () => {
  const html = `<dl class="criteria-card__body"><dt>Issuing body</dt><dd>Yes, this is metadata not an FAQ answer.</dd></dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, true);
});

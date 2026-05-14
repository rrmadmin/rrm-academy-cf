import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFaqAnswers } from './faq-no-affirmative-lead.mjs';

test('clean FAQ passes', () => {
  const html = `<dl class="faq">
    <dt>Q1?</dt><dd>In many cases, yes. But the evidence shows...</dd>
    <dt>Q2?</dt><dd>No, that is a misconception.</dd>
  </dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, true);
});

test('Yes lead fails', () => {
  const html = `<dl><dt>Q?</dt><dd>Yes, in many cases the workup helps.</dd></dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
  assert.match(r.error, /Yes/);
});

test('Absolutely lead fails', () => {
  const html = `<dl><dt>Q?</dt><dd>Absolutely, the data supports this.</dd></dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
});

test('lead inside nested tags fails (HTML-aware)', () => {
  const html = `<dl><dt>Q?</dt><dd><p>Of course, the workup...</p></dd></dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
  assert.match(r.error, /Of course/);
});

test('lead with leading whitespace fails', () => {
  const html = `<dl><dt>Q?</dt><dd>   Yes, this works.</dd></dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
});

test('case-insensitive: yes lowercase fails', () => {
  const html = `<dl><dt>Q?</dt><dd>yes, this is fine.</dd></dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, false);
});

test('No lead is permitted (different risk class)', () => {
  const html = `<dl><dt>Q?</dt><dd>No, that is not accurate.</dd></dl>`;
  const r = checkFaqAnswers(html);
  assert.equal(r.ok, true);
});

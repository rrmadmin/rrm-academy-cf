import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDB } from './_helpers.js';
import { getQuizContent } from '../functions/api/courses/_quiz-content.js';

const STATIC_DATA = { 'step-a': { type: 'quiz', questions: [{ id: 'q1', text: 'S?', options: ['a', 'b'], correctIndex: 0 }] } };
const D1_ENTRY = { type: 'quiz', questions: [{ id: 'q1', text: 'D1?', options: ['a', 'b'], correctIndex: 1 }] };

test('returns D1 rendition when published row exists', async () => {
  const db = mockDB({ 'FROM step_rendition': { first: { content_json: JSON.stringify(D1_ENTRY) } } });
  const quiz = await getQuizContent(db, 'step-a', STATIC_DATA);
  assert.equal(quiz.questions[0].text, 'D1?');
});

test('falls back to static data when no D1 row', async () => {
  const db = mockDB({ 'FROM step_rendition': { first: null } });
  const quiz = await getQuizContent(db, 'step-a', STATIC_DATA);
  assert.equal(quiz.questions[0].text, 'S?');
});

test('falls back to static when D1 content_json is malformed', async () => {
  const db = mockDB({ 'FROM step_rendition': { first: { content_json: '{broken' } } });
  const quiz = await getQuizContent(db, 'step-a', STATIC_DATA);
  assert.equal(quiz.questions[0].text, 'S?');
});

test('falls back to static when D1 query throws', async () => {
  const db = mockDB({ 'FROM step_rendition': { throws: 'd1 down' } });
  const quiz = await getQuizContent(db, 'step-a', STATIC_DATA);
  assert.equal(quiz.questions[0].text, 'S?');
});

test('returns null when neither source has the step', async () => {
  const db = mockDB({ 'FROM step_rendition': { first: null } });
  const quiz = await getQuizContent(db, 'step-unknown', STATIC_DATA);
  assert.equal(quiz, null);
});

/**
 * functions/api/admin/courses/[id]/steps/[stepId]/renditions.js
 *
 * Completes test/admin-renditions.test.js, which pins this file's behaviour
 * through mockDB (canned rows matched by SQL substring). The paths left over
 * are the ones a canned matcher cannot reach honestly: the ON CONFLICT upsert
 * actually conflicting, the per-format content validators, the GET listing, and
 * the three catch arms. Those run here against the real SQLite engine, and
 * every write is verified by reading the step_rendition row back out.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  treeDb, ctx, read, throwingD1, mockR2, readRendition,
} from './_course-structure-fixtures.mjs';
import {
  onRequestOptions, onRequestGet, onRequestPut, onRequestDelete,
} from '../functions/api/admin/courses/[id]/steps/[stepId]/renditions.js';

const A1 = { id: 'course-a', stepId: 'step-a1' };
const A3 = { id: 'course-a', stepId: 'step-a3' };
const URL_BASE = 'https://rrmacademy.org/api/admin/courses/course-a/steps/step-a1/renditions';

const seedRendition = (s, stepId, format, contentJson, extra = {}) =>
  s.prepare(`INSERT INTO step_rendition (step_id, format, content_json, status, source, word_count, duration_seconds, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(stepId, format, contentJson, extra.status ?? 'published', extra.source ?? null,
      extra.wordCount ?? null, extra.duration ?? null, '2026-01-01 00:00:00', '2026-01-01 00:00:00');

const put = (db, body, params = A1, opts = {}) =>
  onRequestPut(ctx({ db, params, method: 'PUT', body, url: URL_BASE, ...opts }));
const del = (db, query, params = A1, opts = {}) =>
  onRequestDelete(ctx({ db, params, method: 'DELETE', url: `${URL_BASE}${query}`, r2: opts.r2 ?? mockR2(), ...opts }));

const READING = { format: 'reading', content: { html: '<p>Hello world</p>' } };

// ---------------------------------------------------------------- preflight --

test('renditions OPTIONS preflight answers 204 with CORS headers', () => {
  const res = onRequestOptions();
  assert.equal(res.status, 204);
  assert.ok(res.headers.get('Access-Control-Allow-Methods'));
});

// ---------------------------------------------------------------- misconfig --

test('renditions: 503 on every verb without a DB binding', async () => {
  for (const handler of [onRequestGet, onRequestPut, onRequestDelete]) {
    const res = await handler(ctx({ db: null, params: A1, body: READING, url: `${URL_BASE}?format=reading` }));
    assert.equal(res.status, 503, handler.name);
    assert.equal((await res.json()).error, 'Server misconfigured');
  }
});

test('renditions: 400 invalid_id for bad path params on every verb', async () => {
  const db = treeDb();
  const bad = [{}, { id: 'course-a' }, { id: 1, stepId: 'step-a1' }, { id: 'c'.repeat(101), stepId: 'step-a1' },
    { id: 'course-a', stepId: 2 }, { id: 'course-a', stepId: 's'.repeat(101) }];
  for (const handler of [onRequestGet, onRequestPut, onRequestDelete]) {
    for (const params of bad) {
      const res = await handler(ctx({ db, params, body: READING, url: `${URL_BASE}?format=reading` }));
      assert.equal(res.status, 400, `${handler.name} ${JSON.stringify(params)}`);
      assert.equal((await res.json()).error, 'invalid_id');
    }
  }
  db.close();
});

// -------------------------------------------------------------------- GET --

test('GET renditions: 401 anonymous and 403 non-admin', async () => {
  const db = treeDb();
  assert.equal((await onRequestGet(ctx({ db, params: A1, method: 'GET', user: null }))).status, 401);
  assert.equal((await onRequestGet(ctx({ db, params: A1, method: 'GET', role: 'member' }))).status, 403);
  db.close();
});

test('GET renditions: lists every format for the step, ordered by format, with optional fields folded in', async () => {
  const db = treeDb({
    extraSeed(s) {
      seedRendition(s, 'step-a1', 'reading', JSON.stringify({ html: '<p>r</p>' }), { wordCount: 1, source: 'gen-1' });
      seedRendition(s, 'step-a1', 'audio', JSON.stringify({ r2_key: 'courses/audio/step-a1.mp3' }), { duration: 42 });
      seedRendition(s, 'step-a2', 'reading', JSON.stringify({ html: '<p>other</p>' }));
    },
  });
  const { status, body } = await read(await onRequestGet(ctx({ db, params: A1, method: 'GET' })));
  assert.equal(status, 200);
  assert.deepEqual(body.data.map((r) => r.format), ['audio', 'reading'], 'ORDER BY format ASC');
  const audio = body.data[0];
  assert.equal(audio.stepId, 'step-a1');
  assert.equal(audio.duration, 42);
  assert.equal('wordCount' in audio, false);
  assert.equal('source' in audio, false);
  const reading = body.data[1];
  assert.equal(reading.wordCount, 1);
  assert.equal(reading.source, 'gen-1');
  assert.deepEqual(reading.content, { html: '<p>r</p>' });
  db.close();
});

test('GET renditions: a step with no renditions returns an empty list', async () => {
  const db = treeDb();
  const { body } = await read(await onRequestGet(ctx({ db, params: A1, method: 'GET' })));
  assert.deepEqual(body.data, []);
  db.close();
});

test('GET renditions: malformed stored content_json is reported as null content, not a 500', async () => {
  const db = treeDb({ extraSeed: (s) => seedRendition(s, 'step-a1', 'reading', 'not-json') });
  const { status, body } = await read(await onRequestGet(ctx({ db, params: A1, method: 'GET' })));
  assert.equal(status, 200);
  assert.equal(body.data[0].content, null);
  db.close();
});

test('GET renditions IDOR: step-b1 is 404 through the course-a path', async () => {
  const db = treeDb({ extraSeed: (s) => seedRendition(s, 'step-b1', 'reading', JSON.stringify({ html: '<p>b</p>' })) });
  const res = await onRequestGet(ctx({ db, params: { id: 'course-a', stepId: 'step-b1' }, method: 'GET' }));
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'step_not_found');
  db.close();
});

test('GET renditions: 500 when the list query throws', async () => {
  const db = treeDb();
  const c = ctx({ db: throwingD1(db, 'SELECT * FROM step_rendition WHERE step_id = ? ORDER BY'), params: A1, method: 'GET' });
  assert.equal((await onRequestGet(c)).status, 500);
  assert.ok(c.events.actions().includes('rendition_list_error'));
  db.close();
});

// -------------------------------------------------------------------- PUT --

test('PUT rendition: 400 Invalid JSON and Invalid payload', async () => {
  const db = treeDb();
  assert.equal((await onRequestPut(ctx({ db, params: A1, method: 'PUT', url: URL_BASE }))).status, 400);
  const res = await onRequestPut(ctx({ db, params: A1, method: 'PUT', rawBody: '[]', url: URL_BASE }));
  assert.equal((await res.json()).error, 'Invalid payload');
  db.close();
});

test('PUT rendition: 400 invalid_status and 400 invalid_source', async () => {
  const db = treeDb();
  const status = await put(db, { ...READING, status: 'live' });
  assert.equal((await status.json()).error, 'invalid_status');
  for (const source of [7, 's'.repeat(201)]) {
    const res = await put(db, { ...READING, source });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_source');
  }
  const nullSource = await put(db, { ...READING, source: null });
  assert.equal(nullSource.status, 200, 'an explicit null source is allowed');
  db.close();
});

test('PUT rendition: 400 invalid_content when content is absent or not a plain object', async () => {
  const db = treeDb();
  for (const content of [undefined, null, 'text', 42, ['a']]) {
    const res = await put(db, { format: 'reading', content });
    assert.equal(res.status, 400, JSON.stringify(content));
    assert.equal((await res.json()).error, 'invalid_content');
  }
  db.close();
});

test('PUT rendition reading: stores the sanitised html, its word_count, status and source', async () => {
  const db = treeDb();
  const { status, body } = await read(await put(db, {
    format: 'reading',
    content: { html: '<p>Two words</p>' },
    status: 'published',
    source: 'writer-1',
  }));
  assert.equal(status, 200);
  const row = readRendition(db, 'step-a1', 'reading');
  assert.equal(row.status, 'published');
  assert.equal(row.source, 'writer-1');
  assert.equal(row.word_count, 2);
  assert.equal(row.duration_seconds, null);
  assert.equal(body.data.wordCount, 2);
  assert.deepEqual(body.data.content, JSON.parse(row.content_json));
  db.close();
});

test('PUT rendition reading: a script tag is escaped into text, so it is accepted but inert', async () => {
  const db = treeDb();
  const res = await put(db, { format: 'reading', content: { html: '<p>ok</p><script>alert(1)</script>' } });
  assert.equal(res.status, 200, 'the sanitizer escapes rather than drops, so this is not content_empty');
  const stored = JSON.parse(readRendition(db, 'step-a1', 'reading').content_json).html;
  assert.ok(!stored.includes('<script'), 'no live script tag reaches the row');
  assert.ok(stored.includes('&lt;script&gt;'), 'it is escaped to text');
  db.close();
});

test('PUT rendition reading: 400 content_empty for blank or non-string html', async () => {
  const db = treeDb();
  for (const html of ['   ', 5, undefined, ' ']) {
    const res = await put(db, { format: 'reading', content: { html } });
    assert.equal(res.status, 400, String(html));
    assert.equal((await res.json()).error, 'content_empty');
  }
  assert.equal(readRendition(db, 'step-a1', 'reading'), null);
  db.close();
});

test('PUT rendition flashcards: every rejected card shape is 400 invalid_content', async () => {
  const db = treeDb();
  const bad = [
    { cards: 'nope' },
    { cards: [null] },
    { cards: ['plain string'] },
    { cards: [{ front: 5, back: 'b' }] },
    { cards: [{ front: '  ', back: 'b' }] },
    { cards: [{ front: 'f'.repeat(2001), back: 'b' }] },
    { cards: [{ front: 'f', back: 9 }] },
    { cards: [{ front: 'f', back: '  ' }] },
    { cards: [{ front: 'f', back: 'b'.repeat(4001) }] },
    { cards: [{ front: 'f', back: 'b', source_claim_id: 12 }] },
    { cards: [{ front: 'f', back: 'b', source_claim_id: 'c'.repeat(101) }] },
  ];
  for (const content of bad) {
    const res = await put(db, { format: 'flashcards', content });
    assert.equal(res.status, 400, JSON.stringify(content).slice(0, 60));
    assert.equal((await res.json()).error, 'invalid_content');
  }
  const empty = await put(db, { format: 'flashcards', content: { cards: [] } });
  assert.equal((await empty.json()).error, 'content_empty');
  db.close();
});

test('PUT rendition flashcards: a valid deck is stored and word_count stays null', async () => {
  const db = treeDb();
  const cards = [{ front: 'What is RRM?', back: 'Restorative reproductive medicine', source_claim_id: 'claim-1' }];
  const { status, body } = await read(await put(db, { format: 'flashcards', content: { cards } }));
  assert.equal(status, 200);
  const row = readRendition(db, 'step-a1', 'flashcards');
  assert.deepEqual(JSON.parse(row.content_json), { cards });
  assert.equal(row.word_count, null);
  assert.equal(row.status, 'draft', 'status defaults to draft on insert');
  assert.equal('wordCount' in body.data, false);
  db.close();
});

test('PUT rendition: 400 content_too_large when the serialized payload exceeds the per-format cap', async () => {
  const db = treeDb();
  const cards = Array.from({ length: 10 }, (_, i) => ({ front: `f${i}`.padEnd(1999, 'x'), back: `b${i}`.padEnd(3999, 'y') }));
  const res = await put(db, { format: 'flashcards', content: { cards } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'content_too_large');
  assert.equal(readRendition(db, 'step-a1', 'flashcards'), null, 'nothing over the cap reaches D1');
  db.close();
});

test('PUT rendition quiz: every rejected quiz and questionnaire shape is 400', async () => {
  const db = treeDb();
  const bad = [
    { type: 'survey', questions: [] },
    { type: 'quiz', questions: 'nope' },
    { type: 'quiz', questions: [{ id: 'q1', text: 'Q', options: ['a', 'b'], correctIndex: 0 }], passingScore: 101 },
    { type: 'quiz', questions: [{ id: 'q1', text: 'Q', options: ['a', 'b'], correctIndex: 0 }], passingScore: 1.5 },
    { type: 'quiz', questions: [null] },
    { type: 'quiz', questions: [{ id: 1, text: 'Q' }] },
    { type: 'quiz', questions: [{ id: 'q1', text: '' }] },
    { type: 'quiz', questions: [{ id: 'q1', text: 'Q', options: ['only-one'], correctIndex: 0 }] },
    { type: 'quiz', questions: [{ id: 'q1', text: 'Q', options: ['a', 2], correctIndex: 0 }] },
    { type: 'quiz', questions: [{ id: 'q1', text: 'Q', options: ['a', 'b'], correctIndex: 2 }] },
    { type: 'quiz', questions: [{ id: 'q1', text: 'Q', options: ['a', 'b'], correctIndex: -1 }] },
    { type: 'questionnaire', questions: [{ id: 'q1', text: 'Q', type: 'ranking' }] },
    { type: 'questionnaire', questions: [{ id: 'q1', text: 'Q', type: 'multiselect' }] },
    { type: 'questionnaire', questions: [{ id: 'q1', text: 'Q', type: 'multiselect', options: [] }] },
  ];
  for (const content of bad) {
    const res = await put(db, { format: 'quiz', content });
    assert.equal(res.status, 400, JSON.stringify(content).slice(0, 70));
    assert.equal((await res.json()).error, 'invalid_content', JSON.stringify(content).slice(0, 70));
  }
  const empty = await put(db, { format: 'quiz', content: { type: 'quiz', questions: [] } });
  assert.equal((await empty.json()).error, 'content_empty');
  db.close();
});

test('PUT rendition quiz: a valid quiz and a valid questionnaire are both stored verbatim', async () => {
  const db = treeDb();
  const quiz = { type: 'quiz', passingScore: 80, questions: [{ id: 'q1', text: 'Q', options: ['a', 'b'], correctIndex: 1 }] };
  await put(db, { format: 'quiz', content: quiz });
  assert.deepEqual(JSON.parse(readRendition(db, 'step-a1', 'quiz').content_json), quiz);

  const questionnaire = {
    type: 'questionnaire',
    questions: [
      { id: 'q1', text: 'How often?', type: 'likert' },
      { id: 'q2', text: 'Notes', type: 'freetext' },
      { id: 'q3', text: 'Which?', type: 'multiselect', options: ['a', 'b'] },
    ],
  };
  await put(db, { format: 'quiz', content: questionnaire }, { id: 'course-a', stepId: 'step-a2' });
  assert.deepEqual(JSON.parse(readRendition(db, 'step-a2', 'quiz').content_json), questionnaire);
  db.close();
});

test('PUT rendition audio: r2_key, voice and duration are validated, then duration is denormalised onto the row', async () => {
  const db = treeDb();
  const bad = [
    { r2_key: 9 },
    { r2_key: 'courses/audio/../escape.mp3' },
    { r2_key: 'courses/audio/Step.mp3' },
    { r2_key: 'other/audio/step.mp3' },
    { r2_key: 'courses/audio/step.wav' },
    { r2_key: 'courses/audio/step.mp3', voice: 5 },
    { r2_key: 'courses/audio/step.mp3', voice: 'v'.repeat(101) },
    { r2_key: 'courses/audio/step.mp3', duration_seconds: 1.5 },
    { r2_key: 'courses/audio/step.mp3', duration_seconds: -1 },
    { r2_key: 'courses/audio/step.mp3', duration_seconds: 86401 },
  ];
  for (const content of bad) {
    const res = await put(db, { format: 'audio', content });
    assert.equal(res.status, 400, JSON.stringify(content));
    assert.equal((await res.json()).error, 'invalid_content', JSON.stringify(content));
  }

  const good = { r2_key: 'courses/audio/step-a1.mp3', voice: 'nova', duration_seconds: 300 };
  const { body } = await read(await put(db, { format: 'audio', content: good }));
  const row = readRendition(db, 'step-a1', 'audio');
  assert.deepEqual(JSON.parse(row.content_json), good);
  assert.equal(row.duration_seconds, 300);
  assert.equal(body.data.duration, 300);

  const noDuration = { r2_key: 'courses/audio/step-a2.mp3' };
  await put(db, { format: 'audio', content: noDuration }, { id: 'course-a', stepId: 'step-a2' });
  assert.equal(readRendition(db, 'step-a2', 'audio').duration_seconds, null);
  db.close();
});

test('PUT rendition: the upsert is idempotent and COALESCE preserves status and source when omitted', async () => {
  const db = treeDb();
  await put(db, { ...READING, status: 'published', source: 'run-1' });
  const first = readRendition(db, 'step-a1', 'reading');
  assert.equal(first.status, 'published');
  assert.equal(first.source, 'run-1');

  // A regeneration that sends neither status nor source must not downgrade the
  // published rendition back to draft or wipe its provenance.
  const { status, body } = await read(await put(db, { format: 'reading', content: { html: '<p>regenerated copy</p>' } }));
  assert.equal(status, 200);
  const second = readRendition(db, 'step-a1', 'reading');
  assert.equal(second.status, 'published', 'status survives the conflict update');
  assert.equal(second.source, 'run-1', 'source survives the conflict update');
  assert.match(second.content_json, /regenerated copy/);
  assert.equal(second.created_at, first.created_at, 'created_at is not rewritten');
  assert.equal(body.data.content.html.includes('regenerated copy'), true);
  assert.equal(db._sqlite.prepare("SELECT COUNT(*) c FROM step_rendition WHERE step_id='step-a1'").get().c, 1);
  db.close();
});

test('PUT rendition: an explicit status on the conflict path does overwrite', async () => {
  const db = treeDb();
  await put(db, { ...READING, status: 'draft' });
  await put(db, { ...READING, status: 'published' });
  assert.equal(readRendition(db, 'step-a1', 'reading').status, 'published');
  db.close();
});

test('PUT rendition IDOR: a rendition cannot be written onto step-b1 through the course-a path', async () => {
  const db = treeDb();
  const res = await put(db, READING, { id: 'course-a', stepId: 'step-b1' });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'step_not_found');
  assert.equal(readRendition(db, 'step-b1', 'reading'), null);
  db.close();
});

test('PUT rendition: 409 when drafting or archiving the quiz rendition of a certificate-quiz step', async () => {
  for (const status of ['draft', 'archived']) {
    const db = treeDb({
      extraSeed: (s) => s.prepare("UPDATE course SET certificate_quiz_step_id = 'step-a3' WHERE id = 'course-a'").run(),
    });
    const quiz = { type: 'quiz', questions: [{ id: 'q1', text: 'Q', options: ['a', 'b'], correctIndex: 0 }] };
    const { status: code, body } = await read(await put(db, { format: 'quiz', content: quiz, status }, A3));
    assert.equal(code, 409, status);
    assert.equal(body.error, 'step_referenced_as_certificate_quiz');
    assert.equal(body.courseId, 'course-a');
    assert.equal(readRendition(db, 'step-a3', 'quiz'), null, 'nothing was written');
    db.close();
  }
});

test('PUT rendition: 500 when the upsert throws', async () => {
  const db = treeDb();
  const c = ctx({
    db: throwingD1(db, 'INSERT INTO step_rendition'),
    params: A1, method: 'PUT', body: READING, url: URL_BASE,
  });
  assert.equal((await onRequestPut(c)).status, 500);
  assert.ok(c.events.actions().includes('rendition_put_error'));
  db.close();
});

// ----------------------------------------------------------------- DELETE --

test('DELETE rendition: 401 anonymous and 403 non-admin', async () => {
  const db = treeDb();
  assert.equal((await del(db, '?format=reading', A1, { user: null })).status, 401);
  assert.equal((await del(db, '?format=reading', A1, { role: 'member' })).status, 403);
  db.close();
});

test('DELETE rendition: 400 invalid_format for a missing or unknown format', async () => {
  const db = treeDb();
  for (const query of ['', '?format=', '?format=video', '?other=reading']) {
    const res = await del(db, query);
    assert.equal(res.status, 400, query);
    assert.equal((await res.json()).error, 'invalid_format');
  }
  db.close();
});

test('DELETE rendition IDOR: step-b1 is 404 through the course-a path', async () => {
  const db = treeDb({ extraSeed: (s) => seedRendition(s, 'step-b1', 'reading', JSON.stringify({ html: '<p>b</p>' })) });
  const res = await del(db, '?format=reading', { id: 'course-a', stepId: 'step-b1' });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'step_not_found');
  assert.ok(readRendition(db, 'step-b1', 'reading'), 'the rendition survives');
  db.close();
});

test('DELETE rendition: 404 rendition_not_found when the step has no such format', async () => {
  const db = treeDb({ extraSeed: (s) => seedRendition(s, 'step-a1', 'reading', JSON.stringify({ html: '<p>r</p>' })) });
  const res = await del(db, '?format=flashcards');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'rendition_not_found');
  assert.ok(readRendition(db, 'step-a1', 'reading'), 'the sibling format is untouched');
  db.close();
});

test('DELETE rendition: removes only the named format', async () => {
  const db = treeDb({
    extraSeed(s) {
      seedRendition(s, 'step-a1', 'reading', JSON.stringify({ html: '<p>r</p>' }));
      seedRendition(s, 'step-a1', 'flashcards', JSON.stringify({ cards: [{ front: 'f', back: 'b' }] }));
    },
  });
  const res = await del(db, '?format=reading');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(readRendition(db, 'step-a1', 'reading'), null);
  assert.ok(readRendition(db, 'step-a1', 'flashcards'));
  db.close();
});

test('DELETE rendition: 409 for the quiz rendition of a certificate-quiz step', async () => {
  const db = treeDb({
    extraSeed(s) {
      s.prepare("UPDATE course SET certificate_quiz_step_id = 'step-a3' WHERE id = 'course-a'").run();
      seedRendition(s, 'step-a3', 'quiz', JSON.stringify({ type: 'quiz', questions: [] }));
    },
  });
  const { status, body } = await read(await del(db, '?format=quiz', A3));
  assert.equal(status, 409);
  assert.equal(body.error, 'step_referenced_as_certificate_quiz');
  assert.ok(readRendition(db, 'step-a3', 'quiz'));
  db.close();
});

test('DELETE rendition audio: the R2 object is deleted after the row goes', async () => {
  const key = 'courses/audio/step-a1.mp3';
  const db = treeDb({ extraSeed: (s) => seedRendition(s, 'step-a1', 'audio', JSON.stringify({ r2_key: key })) });
  const r2 = mockR2();
  assert.equal((await del(db, '?format=audio', A1, { r2 })).status, 200);
  assert.deepEqual(r2.deleted, [key]);
  assert.equal(readRendition(db, 'step-a1', 'audio'), null);
  db.close();
});

test('DELETE rendition audio: malformed or key-less content_json deletes the row and no R2 object', async () => {
  for (const contentJson of ['not-json', JSON.stringify({ voice: 'nova' })]) {
    const db = treeDb({ extraSeed: (s) => seedRendition(s, 'step-a1', 'audio', contentJson) });
    const r2 = mockR2();
    assert.equal((await del(db, '?format=audio', A1, { r2 })).status, 200, contentJson);
    assert.deepEqual(r2.deleted, [], contentJson);
    assert.equal(readRendition(db, 'step-a1', 'audio'), null);
    db.close();
  }
});

test('DELETE rendition audio: without an R2 binding the row still goes', async () => {
  const db = treeDb({
    extraSeed: (s) => seedRendition(s, 'step-a1', 'audio', JSON.stringify({ r2_key: 'courses/audio/step-a1.mp3' })),
  });
  assert.equal((await onRequestDelete(ctx({ db, params: A1, method: 'DELETE', url: `${URL_BASE}?format=audio` }))).status, 200);
  assert.equal(readRendition(db, 'step-a1', 'audio'), null);
  db.close();
});

test('DELETE rendition audio: a failing R2 delete is logged and the request still succeeds', async () => {
  const key = 'courses/audio/step-a1.mp3';
  const db = treeDb({ extraSeed: (s) => seedRendition(s, 'step-a1', 'audio', JSON.stringify({ r2_key: key })) });
  const c = ctx({ db, params: A1, method: 'DELETE', url: `${URL_BASE}?format=audio`, r2: mockR2({ failDeleteKey: key }) });
  assert.equal((await onRequestDelete(c)).status, 200);
  assert.ok(c.events.actions().includes('rendition_r2_delete_error'));
  assert.equal(readRendition(db, 'step-a1', 'audio'), null);
  db.close();
});

test('DELETE rendition: 500 when the delete statement throws', async () => {
  const db = treeDb({ extraSeed: (s) => seedRendition(s, 'step-a1', 'reading', JSON.stringify({ html: '<p>r</p>' })) });
  const c = ctx({
    db: throwingD1(db, 'DELETE FROM step_rendition'),
    params: A1, method: 'DELETE', url: `${URL_BASE}?format=reading`, r2: mockR2(),
  });
  assert.equal((await onRequestDelete(c)).status, 500);
  assert.ok(c.events.actions().includes('rendition_delete_error'));
  assert.ok(readRendition(db, 'step-a1', 'reading'));
  db.close();
});

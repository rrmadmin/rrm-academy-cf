/**
 * The reporter mapping: what this repo's rows look like after 2026-09-09.
 *
 * Before that date eight subsystems wrote their own first blob into
 * worker_events ('mail', 'ai-bot', 'survey', 'track', 'idempotency',
 * 'billing', 'auth', 'email_validate'), and several rows put an HTTP status
 * code, a two letter country code, a Wix subscription id or a post id into
 * blob4. The observatory reads blob1 as the worker name and blob4 as the
 * health status, so those rows rendered as workers nobody deployed, carrying
 * a status nothing could parse.
 *
 * These are the invariants that stop that coming back. They are asserted at
 * the level the observatory reads, not at the level of any one endpoint, so a
 * new call site cannot pass by choosing different words.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { r, normalizeStatus, statusFromHttp } from '../functions/_report.js';
import { log } from '../functions/api/_log.js';

/** The five words `rrm-observatory` reads out of blob4. */
const STATUS_WORDS = ['ok', 'error', 'slow', 'start', 'warn'];

const recorder = () => {
  const rows = [];
  return { rows, env: { EVENTS: { writeDataPoint: (row) => rows.push(row) } } };
};

describe('blob1 is this worker and nothing else', () => {
  it('every row the reporter writes names rrm-academy first', () => {
    const { rows, env } = recorder();
    r.event(env, 'track', 'cta_click', 'ok', 'organic');
    r.error(env, 'billing', 'metadata-handoff-error', new Error('stripe down'));
    r.aeFor(env, 'mail').writeDataPoint({
      blobs: ['mail', 'cf_rrm', 'welcome', 'ok', 'queued'],
      doubles: [12, 1, 0],
      indexes: ['cf_rrm'],
    });
    log(env, () => {}, 'auth', 'login_success', 'ok', 'u_1', 8, 200);
    assert.equal(rows.length, 4);
    for (const row of rows) assert.equal(row.blobs[0], 'rrm-academy');
  });

  it('the mail package row is re-attributed rather than dropped', () => {
    const { rows, env } = recorder();
    r.aeFor(env, 'mail').writeDataPoint({
      blobs: ['mail', 'cf_rrm', 'welcome', 'error', 'refused by lane rule'],
      doubles: [3, 1, 0],
      indexes: ['cf_rrm'],
    });
    // The lane becomes the action, so it stays the index; the purpose has
    // nowhere of its own in a five blob row and leads the detail instead.
    assert.deepEqual(rows[0].blobs,
      ['rrm-academy', 'mail', 'cf_rrm', 'error', 'welcome refused by lane rule']);
    assert.deepEqual(rows[0].indexes, ['cf_rrm']);
  });
});

describe('blob4 is a status and only a status', () => {
  it('maps every word this repo used to write into the vocabulary', () => {
    for (const word of STATUS_WORDS) {
      assert.deepEqual(normalizeStatus(word), { status: word, note: '' });
    }
    assert.deepEqual(normalizeStatus('warning'), { status: 'warn', note: 'warning' });
    assert.deepEqual(normalizeStatus('limited'), { status: 'warn', note: 'limited' });
    assert.deepEqual(normalizeStatus('skipped'), { status: 'ok', note: 'skipped' });
    assert.deepEqual(normalizeStatus('info'), { status: 'ok', note: 'info' });
    assert.deepEqual(normalizeStatus('reprocess'), { status: 'ok', note: 'reprocess' });
    assert.deepEqual(normalizeStatus('block'), { status: 'warn', note: 'block' });
  });

  it('an unknown word lands on warn and keeps itself in the note', () => {
    // The point of a central map: a call site that invents a word cannot make
    // this repo unreadable, it just reports conservatively and says what it
    // meant. 'event_hit' is a real one, from the OG card renderer.
    assert.deepEqual(normalizeStatus('event_hit'), { status: 'warn', note: 'event_hit' });
    assert.deepEqual(normalizeStatus(''), { status: 'ok', note: '' });
    assert.deepEqual(normalizeStatus(undefined), { status: 'ok', note: '' });
  });

  it('an HTTP status code becomes one of the words, and stays in double3', () => {
    assert.equal(statusFromHttp(200), 'ok');
    assert.equal(statusFromHttp(302), 'ok');
    assert.equal(statusFromHttp(404), 'warn');
    assert.equal(statusFromHttp(429), 'warn');
    assert.equal(statusFromHttp(500), 'error');
    assert.equal(statusFromHttp(502), 'error');
    assert.equal(statusFromHttp(undefined), 'ok');

    const { rows, env } = recorder();
    log(env, () => {}, 'ask', 'query', 'error', 'upstream', 120, 502);
    assert.equal(rows[0].blobs[3], 'error');
    assert.equal(rows[0].doubles[2], 502, 'the code itself belongs in double3, not blob4');
  });

  it('log() keeps an out-of-vocabulary word by moving it into the detail', () => {
    const { rows, env } = recorder();
    log(env, () => {}, 'billing', 'metadata_handoff_deferred', 'info', 'sub not active');
    assert.equal(rows[0].blobs[3], 'ok');
    assert.equal(rows[0].blobs[4], 'info: sub not active');
  });
});

describe('log() keeps the contract its 481 call sites were written against', () => {
  it('writes the canonical columns, with the action as the index', () => {
    const { rows, env } = recorder();
    log(env, () => {}, 'contact', 'submit_ok', 'ok', 'anonymous', 34, 200);
    assert.deepEqual(rows[0].blobs, ['rrm-academy', 'contact', 'submit_ok', 'ok', 'anonymous']);
    assert.deepEqual(rows[0].doubles, [34, 1, 200]);
    assert.deepEqual(rows[0].indexes, ['submit_ok']);
  });

  it('still redacts an email address out of the detail and the extras (PRIV-02)', () => {
    const { rows, env } = recorder();
    log(env, () => {}, 'contact', 'submit_ok', 'ok', 'from ada@example.com', 0, 200,
      ['stuc-billing', 'bob@example.com']);
    assert.ok(!rows[0].blobs[4].includes('@'), rows[0].blobs[4]);
    assert.match(rows[0].blobs[4], /\[redacted-email\]/);
    assert.match(rows[0].blobs[4], /stuc-billing/, 'a non-PII extra must survive');
  });

  it('folds extras onto the detail rather than into blob6 and blob7', () => {
    // The package writes a five blob row. Seven call sites pass extras and
    // nothing has ever read blob6 or blob7 from worker_events, so they go on
    // the end of the detail where every query already looks.
    const { rows, env } = recorder();
    log(env, () => {}, 'google_ads', 'conversion_error', 'error', 'token_401', 0, 502,
      ['gclid-abc', '7671519545']);
    assert.equal(rows[0].blobs.length, 5);
    assert.equal(rows[0].blobs[4], 'token_401 gclid-abc 7671519545');
  });

  it('is a no-op, never a throw, when the binding is absent or broken', () => {
    assert.doesNotThrow(() => log({}, () => {}, 'a', 'b', 'ok', 'c'));
    assert.doesNotThrow(() => log(
      { EVENTS: { writeDataPoint() { throw new Error('AE over quota'); } } },
      () => {}, 'a', 'b', 'ok', 'c'));
  });
});

describe('no Pages Function writes Analytics Engine by hand', () => {
  // The one gate that survives a new endpoint being added by somebody who has
  // not read any of the above. A raw writeDataPoint is how blob1 stopped being
  // the worker name eight separate times.
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

  it('every AE row in functions/ goes through functions/_report.js', () => {
    const offenders = walk(new URL('../functions', import.meta.url).pathname)
      .filter((path) => path.endsWith('.js'))
      .filter((path) => /(?<![/\w])writeDataPoint\s*\(/.test(
        readFileSync(path, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')));
    assert.deepEqual(offenders, [],
      'these files call writeDataPoint directly; route them through functions/_report.js');
  });
});

/**
 * Harness self-test for test/_helpers.js mockDB.
 *
 * The mock matches queries by SQL substring and used to hand back its canned
 * row whatever was bound, which made EVERY "this lookup is case-insensitive"
 * assertion in the suite vacuous: dropping COLLATE NOCASE from a production
 * query changed nothing any test could observe. These tests pin the collation
 * model itself, so the hole cannot reopen without a red suite.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mockDB, bindingCollations } from './_helpers.js';

describe('mockDB -- binding collation is read off the statement', () => {
  it('a bare placeholder is BINARY, a COLLATE NOCASE placeholder is NOCASE', () => {
    assert.deepEqual(bindingCollations('SELECT id FROM user WHERE email = ?'), ['binary']);
    assert.deepEqual(bindingCollations('SELECT id FROM user WHERE email = ? COLLATE NOCASE'), ['nocase']);
  });

  it('COLLATE NOCASE scopes to the comparison it trails, not the whole statement', () => {
    assert.deepEqual(
      bindingCollations('SELECT id FROM user WHERE email = ? COLLATE NOCASE AND role = ?'),
      ['nocase', 'binary']
    );
    assert.deepEqual(
      bindingCollations('SELECT id FROM user WHERE role = ? AND email = ? COLLATE NOCASE'),
      ['binary', 'nocase']
    );
  });

  it('numbered placeholders bind by number, and an ESCAPE clause does not hide the collation', () => {
    assert.deepEqual(
      bindingCollations('UPDATE course_waitlist SET user_id = ?1 WHERE email = ?2 COLLATE NOCASE'),
      ['binary', 'nocase']
    );
    assert.deepEqual(bindingCollations("SELECT 1 WHERE email LIKE ? ESCAPE '\\' COLLATE NOCASE"), ['nocase']);
  });
});

describe('mockDB -- stored values are matched under the statement collation', () => {
  const spec = { stored: 'Buyer@Example.COM', first: { id: 'usr_1' } };

  it('a case-insensitive lookup finds a case-mismatched row', async () => {
    const db = mockDB({ 'FROM user WHERE email': spec });
    const row = await db.prepare('SELECT id FROM user WHERE email = ? COLLATE NOCASE').bind('buyer@example.com').first();
    assert.deepEqual(row, { id: 'usr_1' });
  });

  it('a case-SENSITIVE lookup misses the same row -- this is what kills the mutation', async () => {
    const db = mockDB({ 'FROM user WHERE email': spec });
    const row = await db.prepare('SELECT id FROM user WHERE email = ?').bind('buyer@example.com').first();
    assert.equal(row, null);
  });

  it('an exact-case bind still matches without COLLATE NOCASE', async () => {
    const db = mockDB({ 'FROM user WHERE email': spec });
    const row = await db.prepare('SELECT id FROM user WHERE email = ?').bind('Buyer@Example.COM').first();
    assert.deepEqual(row, { id: 'usr_1' });
  });

  it('a miss answers the way D1 answers: no results, and zero changes on a write', async () => {
    const db = mockDB({
      'FROM contact WHERE email': { stored: 'Ada@Example.com', all: { results: [{ id: 1 }] } },
      'UPDATE contact SET': { stored: 'Ada@Example.com', run: { success: true, meta: { changes: 1 } } },
    });
    assert.deepEqual(await db.prepare('SELECT id FROM contact WHERE email = ?').bind('ada@example.com').all(), { results: [] });
    const write = await db.prepare('UPDATE contact SET total = 1 WHERE email = ?').bind('ada@example.com').run();
    assert.equal(write.meta.changes, 0);
  });

  it('positional slots line up with the bindings, and null slots are wildcards', async () => {
    const db = mockDB({ 'FROM wix_subscription': { stored: [null, 'Ada@Example.com'], first: { id: 'wxs_1' } } });
    const stmt = (sql, ...args) => db.prepare(sql).bind(...args).first();
    assert.deepEqual(
      await stmt('SELECT id FROM wix_subscription WHERE status = ? AND email = ? COLLATE NOCASE', 'active', 'ada@example.com'),
      { id: 'wxs_1' }
    );
    assert.deepEqual(
      await stmt('SELECT id FROM wix_subscription WHERE status = ? AND email = ? COLLATE NOCASE', 'anything-at-all', 'ada@example.com'),
      { id: 'wxs_1' }
    );
    assert.equal(
      await stmt('SELECT id FROM wix_subscription WHERE status = ? AND email = ?', 'active', 'ada@example.com'),
      null
    );
  });

  it('batch() honours the same model so a batched write reports 0 changes on a miss', async () => {
    const db = mockDB({ 'UPDATE user SET': { stored: 'Ada@Example.com', run: { success: true, meta: { changes: 1 } } } });
    const [hit, miss] = await db.batch([
      db.prepare('UPDATE user SET blocked = 1 WHERE email = ? COLLATE NOCASE').bind('ada@example.com'),
      db.prepare('UPDATE user SET blocked = 1 WHERE email = ?').bind('ada@example.com'),
    ]);
    assert.equal(hit.meta.changes, 1);
    assert.equal(miss.meta.changes, 0);
  });

  it('a spec with no stored value keeps the old unconditional behaviour', async () => {
    const db = mockDB({ 'FROM user': { first: { id: 'usr_1' } } });
    assert.deepEqual(await db.prepare('SELECT id FROM user WHERE email = ?').bind('anything').first(), { id: 'usr_1' });
  });
});

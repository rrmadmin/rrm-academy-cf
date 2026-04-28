import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signMigrationToken, validateMigrationToken } from '../functions/api/billing/_migration-token.js';

const SECRET = 'test-secret-for-node-test-only';

describe('migration token', () => {
  it('round-trips a valid token', async () => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const token = await signMigrationToken({ wix_sub_id: 'wxs_abc123', exp }, SECRET);
    const result = await validateMigrationToken(token, SECRET);
    assert.deepEqual(result, { ok: true, wix_sub_id: 'wxs_abc123' });
  });

  it('rejects forged signature', async () => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const token = await signMigrationToken({ wix_sub_id: 'wxs_abc', exp }, SECRET);
    const result = await validateMigrationToken(token, 'WRONG-SECRET');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'forged');
  });

  it('rejects expired token', async () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const token = await signMigrationToken({ wix_sub_id: 'wxs_abc', exp }, SECRET);
    const result = await validateMigrationToken(token, SECRET);
    assert.deepEqual(result, { ok: false, reason: 'expired' });
  });

  it('rejects malformed payload (non-string wix_sub_id)', async () => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const token = await signMigrationToken({ wix_sub_id: 12345, exp }, SECRET);
    const result = await validateMigrationToken(token, SECRET);
    assert.equal(result.reason, 'malformed');
  });

  it('rejects malformed payload (non-integer exp)', async () => {
    const token = await signMigrationToken({ wix_sub_id: 'wxs_abc', exp: '2099-01-01' }, SECRET);
    const result = await validateMigrationToken(token, SECRET);
    assert.equal(result.reason, 'malformed');
  });

  it('rejects payload not matching wxs_ pattern', async () => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const token = await signMigrationToken({ wix_sub_id: '../../../etc/passwd', exp }, SECRET);
    const result = await validateMigrationToken(token, SECRET);
    assert.equal(result.reason, 'malformed');
  });

  it('rejects empty / no-dot token', async () => {
    const result = await validateMigrationToken('not-a-token', SECRET);
    assert.equal(result.reason, 'malformed');
  });

  it('rejects mismatched-length signature in constant time', async () => {
    const result = await validateMigrationToken('eyJhIjoxfQ.shorty', SECRET);
    assert.equal(result.reason, 'forged');
  });
});

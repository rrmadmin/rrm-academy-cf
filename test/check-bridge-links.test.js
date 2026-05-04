import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runScript(registry, srcFiles) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-links-'));
  const registryPath = join(dir, 'bridge-pages.json');
  const srcDir = join(dir, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  for (const [name, content] of Object.entries(srcFiles)) {
    writeFileSync(join(srcDir, name), content);
  }
  const result = spawnSync('node', [
    'scripts/check-bridge-links.mjs',
    '--registry', registryPath,
    '--src-dir', srcDir,
  ], { encoding: 'utf-8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('check-bridge-links', () => {
  it('passes when registered bridge has at least one inbound link', () => {
    const reg = { pages: [{ url: '/schedule-with-dr-whittaker/', min_inbound_links: 1 }] };
    const src = { 'about.astro': '<a href="/schedule-with-dr-whittaker/">link</a>' };
    const r = runScript(reg, src);
    assert.equal(r.code, 0, r.stderr);
  });

  it('warns when registered bridge has zero inbound links', () => {
    const reg = { pages: [{ url: '/schedule-with-dr-whittaker/', min_inbound_links: 1 }] };
    const src = { 'index.astro': '<h1>Home</h1>' };
    const r = runScript(reg, src);
    // Non-blocking warning: exit code 0 but stderr has the warning
    assert.equal(r.code, 0);
    assert.match(r.stderr + r.stdout, /schedule-with-dr-whittaker/);
    assert.match(r.stderr + r.stdout, /WARNING|warn/i);
  });
});

/**
 * Tests for scripts/check-persona-enum-sync.mjs
 *
 * The script reads:
 *   - docs/personas/rrm-academy-personas.md frontmatter (extracts contact_form_category values)
 *   - src/lib/contact-categories.js (extracts CONTACT_CATEGORIES array)
 *
 * Asserts: every non-null contact_form_category in the persona doc
 * appears in CONTACT_CATEGORIES, and every value in CONTACT_CATEGORIES
 * appears for at least one persona OR is justified (e.g., 'other' as catch-all).
 *
 * Run with: node --test test/check-persona-enum-sync.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runScript(personaDocContent, categoriesJsContent) {
  const dir = mkdtempSync(join(tmpdir(), 'persona-sync-'));
  const personaPath = join(dir, 'personas.md');
  const jsPath = join(dir, 'contact-categories.js');
  writeFileSync(personaPath, personaDocContent);
  writeFileSync(jsPath, categoriesJsContent);

  const result = spawnSync('node', [
    'scripts/check-persona-enum-sync.mjs',
    '--persona-doc', personaPath,
    '--categories-file', jsPath,
  ], { encoding: 'utf-8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('check-persona-enum-sync', () => {
  it('passes when persona doc and categories file are in sync', () => {
    const persona = `---
personas:
  - id: a
    contact_form_category: course
  - id: b
    contact_form_category: bug
  - id: c
    contact_form_category: null
---
# Personas`;
    const js = `export const CONTACT_CATEGORIES = ['course', 'bug', 'other'];`;
    const r = runScript(persona, js);
    assert.equal(r.code, 0, r.stderr);
  });

  it('fails when persona doc has a category not in JS', () => {
    const persona = `---
personas:
  - id: a
    contact_form_category: course
  - id: b
    contact_form_category: ghost
---`;
    const js = `export const CONTACT_CATEGORIES = ['course', 'bug'];`;
    const r = runScript(persona, js);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr + r.stdout, /ghost/);
  });

  it('fails when JS has a non-other value not used by any persona', () => {
    const persona = `---
personas:
  - id: a
    contact_form_category: course
---`;
    const js = `export const CONTACT_CATEGORIES = ['course', 'unused-one'];`;
    const r = runScript(persona, js);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr + r.stdout, /unused-one/);
  });

  it('allows "other" in JS even without explicit persona', () => {
    const persona = `---
personas:
  - id: a
    contact_form_category: course
  - id: b
    contact_form_category: other
---`;
    const js = `export const CONTACT_CATEGORIES = ['course', 'other'];`;
    const r = runScript(persona, js);
    assert.equal(r.code, 0);
  });
});

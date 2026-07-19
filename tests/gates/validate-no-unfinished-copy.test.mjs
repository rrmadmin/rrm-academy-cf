import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSource } from '../../scripts/gates/validate-no-unfinished-copy.mjs';

test('catches the "actively edited" editorial confession', () => {
  const src = `<aside><p><strong>Editor's note:</strong> This guide is being actively edited.</p></aside>`;
  const hits = checkSource(src);
  assert.equal(hits.length, 1);
  assert.match(hits[0].label, /actively edited/);
});

test('catches "Owner TBC" placeholder', () => {
  assert.equal(checkSource('<span>Owner TBC</span>').length, 1);
});

test('catches a stale "Soon" status pill', () => {
  assert.equal(checkSource('<span class="nav__pill">Soon</span>').length, 1);
});

test('does NOT flag "Coming Soon" (designed product state)', () => {
  assert.equal(checkSource('<span class="badge badge--coming-soon">Coming Soon</span>').length, 0);
});

test('does NOT flag the FABM authored soft notice', () => {
  const src = `editingNoticeHtml="<strong>A quick note:</strong> this guide is newly published and still being reviewed by our clinical team, so some details may change as we finalize it."`;
  assert.equal(checkSource(src).length, 0);
});

test('does NOT flag TODO inside a code comment', () => {
  const src = `---\nconst x = 1; // TODO: refactor later\n---\n<p>Real copy.</p>`;
  assert.equal(checkSource(src.replace(/^---[\s\S]*?---/, '')) .length, 0);
  // full-file path: frontmatter + line comment both stripped
  assert.equal(checkSource(src).length, 0);
});

test('catches a visible TODO in markup text', () => {
  assert.equal(checkSource('<p>TODO write this section</p>').length, 1);
});

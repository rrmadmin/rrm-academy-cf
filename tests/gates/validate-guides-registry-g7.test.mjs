// tests/gates/validate-guides-registry-g7.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { gateG7 } from '../../scripts/gates/validate-guides-registry.mjs';

const mkReg = (overrides) => ({
  guides: [{ slug: 'demo', file: 'demo/index.astro', usesGuideLayout: false, ...overrides }],
});

test('G7: usesGuideLayout:true page that imports BaseLayout directly fails', () => {
  const src = `---\nimport BaseLayout from '../../layouts/BaseLayout.astro';\n---\n<BaseLayout title="x">y</BaseLayout>`;
  const issues = gateG7(mkReg({ usesGuideLayout: true }), () => src);
  assert.ok(issues.some((i) => i.includes('must import GuideLayout') || i.includes('must NOT import or use BaseLayout')));
});

test('G7: usesGuideLayout:true page that imports GuideLayout and has no BaseLayout passes', () => {
  const src = `---\nimport GuideLayout from '../../layouts/GuideLayout.astro';\n---\n<GuideLayout slug="demo">y</GuideLayout>`;
  const issues = gateG7(mkReg({ usesGuideLayout: true }), () => src);
  assert.deepStrictEqual(issues, []);
});

test('G7: usesGuideLayout:false page that imports GuideLayout fails (half-revert)', () => {
  const src = `---\nimport GuideLayout from '../../layouts/GuideLayout.astro';\n---\n<GuideLayout slug="demo">y</GuideLayout>`;
  const issues = gateG7(mkReg({ usesGuideLayout: false }), () => src);
  assert.ok(issues.some((i) => i.includes('must NOT import GuideLayout')));
});

test('G7: a commented import does not satisfy the anchored regex', () => {
  const src = `---\n// import GuideLayout from '../../layouts/GuideLayout.astro';\nimport BaseLayout from '../../layouts/BaseLayout.astro';\n---\n<BaseLayout title="x">y</BaseLayout>`;
  const issues = gateG7(mkReg({ usesGuideLayout: true }), () => src);
  assert.ok(issues.length > 0);
});

test('G7: migrated page may keep an ItemList literal (passthrough, not banned)', () => {
  const src = `---\nimport GuideLayout from '../../layouts/GuideLayout.astro';\nconst extra = [{ '@type': 'ItemList' }];\n---\n<GuideLayout slug="demo" extraSchema={extra}>y</GuideLayout>`;
  const issues = gateG7(mkReg({ usesGuideLayout: true }), () => src);
  assert.deepStrictEqual(issues, []);
});

test('G7: migrated page that hand-rolls a BreadcrumbList literal fails', () => {
  const src = `---\nimport GuideLayout from '../../layouts/GuideLayout.astro';\nconst bc = { '@type': 'BreadcrumbList' };\n---\n<GuideLayout slug="demo">y</GuideLayout>`;
  const issues = gateG7(mkReg({ usesGuideLayout: true }), () => src);
  assert.ok(issues.some((i) => i.includes('BreadcrumbList')));
});

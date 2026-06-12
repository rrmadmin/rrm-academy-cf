// tests/gates/validate-guides-registry-g7.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { gateG7 } from '../../scripts/gates/validate-guides-registry.mjs';

const mkReg = (overrides) => ({
  guides: [{ slug: 'demo', file: 'demo/index.astro', usesPillarLayout: false, ...overrides }],
});

test('G7: usesPillarLayout:true page that imports BaseLayout directly fails', () => {
  const src = `---\nimport BaseLayout from '../../layouts/BaseLayout.astro';\n---\n<BaseLayout title="x">y</BaseLayout>`;
  const issues = gateG7(mkReg({ usesPillarLayout: true }), () => src);
  assert.ok(issues.some((i) => i.includes('must import PillarLayout') || i.includes('must NOT import or use BaseLayout')));
});

test('G7: usesPillarLayout:true page that imports PillarLayout and has no BaseLayout passes', () => {
  const src = `---\nimport PillarLayout from '../../layouts/PillarLayout.astro';\n---\n<PillarLayout slug="demo">y</PillarLayout>`;
  const issues = gateG7(mkReg({ usesPillarLayout: true }), () => src);
  assert.deepStrictEqual(issues, []);
});

test('G7: usesPillarLayout:false page that imports PillarLayout fails (half-revert)', () => {
  const src = `---\nimport PillarLayout from '../../layouts/PillarLayout.astro';\n---\n<PillarLayout slug="demo">y</PillarLayout>`;
  const issues = gateG7(mkReg({ usesPillarLayout: false }), () => src);
  assert.ok(issues.some((i) => i.includes('must NOT import PillarLayout')));
});

test('G7: a commented import does not satisfy the anchored regex', () => {
  const src = `---\n// import PillarLayout from '../../layouts/PillarLayout.astro';\nimport BaseLayout from '../../layouts/BaseLayout.astro';\n---\n<BaseLayout title="x">y</BaseLayout>`;
  const issues = gateG7(mkReg({ usesPillarLayout: true }), () => src);
  assert.ok(issues.length > 0);
});

test('G7: migrated page may keep an ItemList literal (passthrough, not banned)', () => {
  const src = `---\nimport PillarLayout from '../../layouts/PillarLayout.astro';\nconst extra = [{ '@type': 'ItemList' }];\n---\n<PillarLayout slug="demo" extraSchema={extra}>y</PillarLayout>`;
  const issues = gateG7(mkReg({ usesPillarLayout: true }), () => src);
  assert.deepStrictEqual(issues, []);
});

test('G7: migrated page that hand-rolls a BreadcrumbList literal fails', () => {
  const src = `---\nimport PillarLayout from '../../layouts/PillarLayout.astro';\nconst bc = { '@type': 'BreadcrumbList' };\n---\n<PillarLayout slug="demo">y</PillarLayout>`;
  const issues = gateG7(mkReg({ usesPillarLayout: true }), () => src);
  assert.ok(issues.some((i) => i.includes('BreadcrumbList')));
});

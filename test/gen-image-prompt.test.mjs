import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPrompt,
  parseArgs,
  REGISTERS,
  DEFAULT_REGISTER,
  BRAND_PURPLE,
  BABY_AVOID,
  SCENE_AVOID,
} from '../scripts/lib/gen-image-style.mjs';

test('REGISTERS has the anatomical and scene registers', () => {
  assert.deepEqual(Object.keys(REGISTERS).sort(), ['anatomical', 'scene']);
  for (const key of ['anatomical', 'scene']) {
    const r = REGISTERS[key];
    assert.ok(r.intro.length > 0);
    assert.ok(r.mood.length > 0);
    assert.ok(r.style.length > 0);
    assert.ok(r.color.length > 0);
    assert.ok(r.composition.length > 0);
  }
});

test('BRAND_PURPLE is the RRM Academy brand purple', () => {
  assert.equal(BRAND_PURPLE, '#725e7e');
});

test('DEFAULT_REGISTER is scene', () => {
  assert.equal(DEFAULT_REGISTER, 'scene');
});

test('buildPrompt includes the topic and scene', () => {
  const p = buildPrompt({ topic: 'PCOS', scene: 'a woman seated at a table' });
  assert.match(p, /Topic: PCOS\./);
  assert.match(p, /Scene: a woman seated at a table/);
});

test('buildPrompt defaults to the scene register', () => {
  const p = buildPrompt({ topic: 'x', scene: 'y' });
  assert.ok(p.includes(REGISTERS.scene.style));
  assert.ok(!p.includes(REGISTERS.anatomical.style));
});

test('buildPrompt uses the requested register', () => {
  const a = buildPrompt({ topic: 'x', scene: 'y', register: 'anatomical' });
  assert.ok(a.includes(REGISTERS.anatomical.style));
  assert.ok(!a.includes(REGISTERS.scene.style));
});

test('buildPrompt throws on an unknown register', () => {
  assert.throws(
    () => buildPrompt({ topic: 'x', scene: 'y', register: 'diagram' }),
    /unknown register: diagram/,
  );
});

test('scene register includes the People block, omits it for a still-life', () => {
  const person = buildPrompt({ topic: 'x', scene: 'y', figures: 'one' });
  const still = buildPrompt({ topic: 'x', scene: 'y', figures: 'still-life' });
  assert.ok(person.includes('People:'));
  assert.ok(!still.includes('People:'));
});

test('anatomical register never includes the People block', () => {
  const a = buildPrompt({ topic: 'x', scene: 'y', register: 'anatomical', figures: 'couple' });
  assert.ok(!a.includes('People:'));
});

test('anatomical register puts the plate on white with brand-purple label chips', () => {
  const a = buildPrompt({ topic: 'x', scene: 'y', register: 'anatomical' });
  assert.match(a, /plain white background/);
  assert.match(a, /brand-purple chip/);
});

test('scene register asks for soft, dissolving edges', () => {
  const p = buildPrompt({ topic: 'x', scene: 'y' });
  assert.match(p, /edges are deliberately soft and undefined/);
  assert.match(p, /outer edges dissolve/);
});

test('scene register bans baby imagery by default, allows it with allowInfant', () => {
  const def = buildPrompt({ topic: 'x', scene: 'y' });
  const allow = buildPrompt({ topic: 'x', scene: 'y', allowInfant: true });
  assert.ok(def.includes(BABY_AVOID));
  assert.ok(!allow.includes(BABY_AVOID));
});

test('scene register always carries the scene avoid list', () => {
  const p = buildPrompt({ topic: 'x', scene: 'y', allowInfant: true });
  assert.ok(p.includes(SCENE_AVOID));
  assert.match(p, /hard outlines and crisp cut-out edges/);
});

test('anatomical register carries its own avoid list, not the baby or scene clauses', () => {
  const a = buildPrompt({ topic: 'x', scene: 'y', register: 'anatomical' });
  assert.match(a, /surgical or operative imagery/);
  assert.ok(!a.includes(BABY_AVOID));
  assert.ok(!a.includes(SCENE_AVOID));
});

test('a custom avoid string is prepended to the register avoid list', () => {
  const p = buildPrompt({ topic: 'x', scene: 'y', avoid: 'clocks and hourglasses' });
  assert.match(p, /Avoid: clocks and hourglasses;/);
});

test('parseArgs reads --key value pairs', () => {
  const a = parseArgs(['--topic', 'PCOS', '--scene', 'a table', '--out', 'pcos']);
  assert.deepEqual(a, { topic: 'PCOS', scene: 'a table', out: 'pcos' });
});

test('parseArgs treats boolean flags as true with no value', () => {
  const a = parseArgs(['--dry-run', '--out', 'x', '--allow-infant']);
  assert.equal(a['dry-run'], true);
  assert.equal(a['allow-infant'], true);
  assert.equal(a.out, 'x');
});

test('parseArgs reads --flat as a value, not a boolean', () => {
  const a = parseArgs(['--finalize', 'pcos', '--flat', 'f7f5f3']);
  assert.equal(a.flat, 'f7f5f3');
  assert.equal(a.finalize, 'pcos');
});

test('parseArgs rejects a non-flag token', () => {
  assert.throws(() => parseArgs(['topic', 'PCOS']), /bad arg: topic/);
});

test('parseArgs throws when a value flag has no value', () => {
  assert.throws(() => parseArgs(['--out']), /--out requires a value/);
});

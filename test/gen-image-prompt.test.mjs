import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPrompt,
  parseArgs,
  STYLE_DIRECTIONS,
  DEFAULT_STYLE,
} from '../scripts/lib/gen-image-style.mjs';

test('STYLE_DIRECTIONS has the four Phase-1 directions', () => {
  assert.deepEqual(Object.keys(STYLE_DIRECTIONS).sort(), ['A', 'B', 'C', 'D']);
  for (const key of ['A', 'B', 'C', 'D']) {
    assert.ok(STYLE_DIRECTIONS[key].style.length > 0);
    assert.ok(STYLE_DIRECTIONS[key].color.length > 0);
    assert.ok(STYLE_DIRECTIONS[key].label.length > 0);
  }
});

test('buildPrompt includes the topic and scene', () => {
  const p = buildPrompt({ topic: 'PCOS', scene: 'a woman seated at a table' });
  assert.match(p, /Topic: PCOS\./);
  assert.match(p, /Scene: a woman seated at a table/);
});

test('buildPrompt uses the requested style direction', () => {
  const a = buildPrompt({ topic: 'x', scene: 'y', style: 'A' });
  const c = buildPrompt({ topic: 'x', scene: 'y', style: 'C' });
  assert.ok(a.includes(STYLE_DIRECTIONS.A.style));
  assert.ok(c.includes(STYLE_DIRECTIONS.C.style));
  assert.ok(!a.includes(STYLE_DIRECTIONS.C.style));
});

test('buildPrompt defaults to DEFAULT_STYLE', () => {
  const p = buildPrompt({ topic: 'x', scene: 'y' });
  assert.ok(p.includes(STYLE_DIRECTIONS[DEFAULT_STYLE].style));
});

test('buildPrompt throws on an unknown style direction', () => {
  assert.throws(
    () => buildPrompt({ topic: 'x', scene: 'y', style: 'Z' }),
    /unknown style direction: Z/,
  );
});

test('buildPrompt omits the People block for a still-life', () => {
  const still = buildPrompt({ topic: 'x', scene: 'y', figures: 'still-life' });
  const person = buildPrompt({ topic: 'x', scene: 'y', figures: 'one' });
  assert.ok(!still.includes('People:'));
  assert.ok(person.includes('People:'));
});

test('buildPrompt bans baby imagery by default, allows it with allowInfant', () => {
  const def = buildPrompt({ topic: 'x', scene: 'y' });
  const allow = buildPrompt({ topic: 'x', scene: 'y', allowInfant: true });
  assert.match(def, /babies, newborns, infants/);
  assert.ok(!allow.includes('babies, newborns, infants'));
});

test('buildPrompt always bans medical-exam and dosing imagery', () => {
  const p = buildPrompt({ topic: 'x', scene: 'y', allowInfant: true });
  assert.match(p, /medical exam imagery/);
  assert.match(p, /drug or dosing imagery/);
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

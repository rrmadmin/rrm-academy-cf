#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { renderInfographic } from '../src/lib/infographic/templates.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function readInput() {
  const file = arg('--file', null);
  if (file) return readFileSync(file, 'utf8');
  return readFileSync(0, 'utf8'); // stdin
}

try {
  const spec = JSON.parse(readInput());
  const svg = renderInfographic(spec, {
    mode: arg('--mode', 'inline'),
    aspect: arg('--aspect', '1:1'),
    frame: arg('--frame', 'none'),
    platform: arg('--platform', 'ig'),
  });
  process.stdout.write(svg);
  process.exit(0);
} catch (e) {
  process.stderr.write(`error: ${e.message}\n`);
  process.exit(1);
}

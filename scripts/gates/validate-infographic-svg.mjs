#!/usr/bin/env node
import { XMLParser } from 'fast-xml-parser';
import { renderInfographic, ASPECTS } from '../../src/lib/infographic/templates.mjs';
import { SAMPLES } from '../../src/lib/infographic/samples.mjs';

const parser = new XMLParser({ ignoreAttributes: false });
const DASH = /[–—]/;
let count = 0;
const errors = [];

for (const spec of SAMPLES) {
  for (const mode of ['inline', 'standalone']) {
    for (const aspect of Object.keys(ASPECTS)) {
      let svg;
      try { svg = renderInfographic(spec, { mode, aspect }); }
      catch (e) { errors.push(`${spec.template}/${mode}/${aspect}: render threw: ${e.message}`); continue; }
      try { parser.parse(svg); } catch (e) { errors.push(`${spec.template}/${mode}/${aspect}: malformed XML: ${e.message}`); }
      if (DASH.test(svg)) errors.push(`${spec.template}/${mode}/${aspect}: contains em/en dash`);
      count++;
    }
  }
}

if (errors.length) { console.error('FAIL:\n' + errors.join('\n')); process.exit(1); }
console.log(`OK: ${count} renders well-formed, no dashes`);
process.exit(0);

// House-style proof gate for rendered infographic SVGs. Single source of truth used by
// both the CI/pre-commit gate (on SAMPLES) and the build-asset path (on real D1 specs),
// so an off-brand or hand-rolled SVG can never ship. Pure string checks, no XML dependency.
//
// What it enforces (the exact ways a hand-rolled prototype drifts from renderInfographic):
//   1. Carries the canonical font <style> block (proof it came through svgShell).
//   2. Has NO element-level font-family= attribute (fonts must come from that block).
//   3. Contains no em/en dash.
//   4. Branded exports carry the canonical RRM Academy wordmark (its exact viewBox).

import { WORDMARK_VIEWBOX } from './wordmark.mjs';

const DASH = /[–—]/;
// Attribute form `font-family="..."`; the legitimate <style> block uses the colon form
// `font-family:` and never matches this.
const FONT_ATTR = /font-family\s*=\s*["']/;
// svgShell injects exactly this; its presence proves the SVG came through the renderer.
const STYLE_SIGNATURE = '.num{font-family:';
const WORDMARK_SIGNATURE = `viewBox="${WORDMARK_VIEWBOX}"`;

// Returns an array of violation strings (empty == passes).
export function houseStyleErrors(svg, { branded = false } = {}) {
  const errors = [];
  if (typeof svg !== 'string' || !svg.startsWith('<svg')) {
    errors.push('not an SVG string');
    return errors;
  }
  if (!svg.includes(STYLE_SIGNATURE)) {
    errors.push('missing the house font <style> block (not produced by renderInfographic)');
  }
  if (FONT_ATTR.test(svg)) {
    errors.push('element-level font-family= attribute (fonts must come from the <style> block)');
  }
  if (DASH.test(svg)) {
    errors.push('contains an em or en dash');
  }
  if (branded && !svg.includes(WORDMARK_SIGNATURE)) {
    errors.push('branded export is missing the canonical RRM Academy wordmark');
  }
  return errors;
}

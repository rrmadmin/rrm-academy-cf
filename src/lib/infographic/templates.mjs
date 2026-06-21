import { validateSpec } from './validate.mjs';

// Light-theme resolved hexes. Mirror src/styles/global.css; a test asserts the
// key set. The "no hardcoded hex" rule is relaxed here for standalone export only.
export const RESOLVED_LIGHT = {
  'bg-body': '#f7f5f3',
  'text-primary': '#313131',
  'text-secondary': '#636261',
  'purple-50': '#f5f0f8',
  'purple-100': '#e8ddef',
  'purple-300': '#c9b8d3',
  'purple-500': '#987da8',
  'purple-700': '#725e7e',
  'purple-900': '#4c3e54',
  'ig-favorable': '#5f6a52',
  'ig-unfavorable': '#a0697c',
  'ig-neutral': '#725e7e',
};

// One viewBox per aspect; each template re-flows to fill it (M14). Identical
// pixels apply within an aspect only.
export const ASPECTS = {
  '1:1': { w: 1080, h: 1080 },
  '4:5': { w: 1080, h: 1350 },
  '1.91:1': { w: 1200, h: 630 },
};

const XML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
export function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => XML[c]);
}

export function color(token, mode) {
  if (mode === 'standalone') {
    const hex = RESOLVED_LIGHT[token];
    if (!hex) throw new Error(`no resolved hex for token: ${token}`);
    return hex;
  }
  return `var(--${token})`;
}

const FONT_DISPLAY = "'Cormorant Garamond', Georgia, serif";
const FONT_UI = "'Inter', system-ui, sans-serif";

// Shared SVG shell: paper background, role/title/desc, font defs. Body is the
// template-specific markup. alt = composed accessible description.
export function svgShell({ spec, mode, aspect, alt, body }) {
  const { w, h } = ASPECTS[aspect];
  const bg = color('bg-body', mode);
  const fontFace = mode === 'standalone'
    ? `<style>text{font-family:${FONT_UI};} .num{font-family:${FONT_DISPLAY};}</style>`
    : `<style>text{font-family:${FONT_UI};} .num{font-family:${FONT_DISPLAY};}</style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeXml(alt)}">`
    + `<title>${escapeXml(alt)}</title><desc>${escapeXml(alt)}</desc>`
    + fontFace
    + `<rect x="0" y="0" width="${w}" height="${h}" fill="${bg}"/>`
    + body
    + `</svg>`;
}

// Composed alt text from value/label/source (Task 4-5 pass a per-template alt).
export function sourceLine(spec) {
  const s = spec.source || {};
  const id = s.pmid ? `PMID ${s.pmid}` : s.doi ? `DOI ${s.doi}` : (s.url || '');
  return [s.label, id].filter(Boolean).join(', ');
}

// Dispatcher. Per-template renderers registered by Tasks 4-5.
const RENDERERS = {};
export function registerRenderer(name, fn) { RENDERERS[name] = fn; }

export function renderInfographic(spec, opts = {}) {
  const mode = opts.mode || 'inline';
  const aspect = opts.aspect || '1:1';
  if (!ASPECTS[aspect]) throw new Error(`unknown aspect: ${aspect}`);
  const v = validateSpec(spec);
  if (!v.valid) throw new Error(`invalid spec: ${v.errors.join('; ')}`);
  const fn = RENDERERS[spec.template];
  if (!fn) throw new Error(`no renderer for template: ${spec.template}`);
  return fn(spec, { mode, aspect });
}

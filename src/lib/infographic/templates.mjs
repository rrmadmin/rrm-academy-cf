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

// Task 4 helpers: eyebrow label + provenance line.
function eyebrow(spec, mode, x, y) {
  return `<text x="${x}" y="${y}" font-size="34" font-weight="600" letter-spacing="3" fill="${color('text-secondary', mode)}">${escapeXml(spec.eyebrow.toUpperCase())}</text>`;
}
function provenance(spec, mode, x, y, w) {
  return `<line x1="${x}" y1="${y - 30}" x2="${x + w}" y2="${y - 30}" stroke="${color('purple-100', mode)}" stroke-width="2"/>`
    + `<text x="${x}" y="${y}" font-size="26" fill="${color('text-secondary', mode)}">${escapeXml('Source: ' + sourceLine(spec))}</text>`;
}

// Task 4 renderers.
function renderSingle(spec, { mode, aspect }) {
  const { w, h } = ASPECTS[aspect];
  const pad = Math.round(w * 0.07);
  const alt = `${spec.value} ${spec.label}. Source: ${sourceLine(spec)}`;
  const body = eyebrow(spec, mode, pad, pad + 36)
    + `<text x="${pad}" y="${h * 0.55}" class="num" font-size="${Math.round(h * 0.3)}" font-weight="600" fill="${color('purple-700', mode)}">${escapeXml(spec.value)}</text>`
    + `<text x="${pad}" y="${h * 0.7}" font-size="40" fill="${color('text-primary', mode)}">${escapeXml(spec.label)}</text>`
    + provenance(spec, mode, pad, h - pad, w - pad * 2);
  return svgShell({ spec, mode, aspect, alt, body });
}

function renderDelta(spec, { mode, aspect }) {
  const { w, h } = ASPECTS[aspect];
  const pad = Math.round(w * 0.07);
  const accent = color(spec.polarity === 'favorable' ? 'ig-favorable' : spec.polarity === 'unfavorable' ? 'ig-unfavorable' : 'ig-neutral', mode);
  const chevron = spec.direction === 'up' ? '▲' : '▼';
  const tag = spec.polarity === 'favorable' ? 'Favorable' : spec.polarity === 'unfavorable' ? 'Unfavorable' : 'Neutral';
  const alt = `${chevron} ${spec.value} ${spec.label} (${tag}). Source: ${sourceLine(spec)}`;
  const body = eyebrow(spec, mode, pad, pad + 36)
    + `<text x="${pad}" y="${h * 0.5}" class="num" font-size="${Math.round(h * 0.24)}" font-weight="600" fill="${accent}">${escapeXml(chevron + ' ' + spec.value)}</text>`
    + `<text x="${pad}" y="${h * 0.63}" font-size="40" fill="${color('text-primary', mode)}">${escapeXml(spec.label)}</text>`
    + `<text x="${pad}" y="${h * 0.73}" font-size="28" font-weight="600" letter-spacing="2" fill="${accent}">${escapeXml(tag.toUpperCase())}</text>`
    + provenance(spec, mode, pad, h - pad, w - pad * 2);
  return svgShell({ spec, mode, aspect, alt, body });
}

// Dispatcher. Per-template renderers registered by Tasks 4-5.
const RENDERERS = {};
export function registerRenderer(name, fn) { RENDERERS[name] = fn; }

registerRenderer('single', renderSingle);
registerRenderer('delta', renderDelta);

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

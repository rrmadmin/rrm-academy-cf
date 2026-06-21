import { validateSpec } from './validate.mjs';
import { wordmarkSvg } from './wordmark.mjs';

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

// One canvas per aspect. Templates render into a CONTENT BOX (full canvas when
// bare, inset for the branded frame); each format re-flows to its box.
export const ASPECTS = {
  '1:1': { w: 1080, h: 1080 },
  '4:5': { w: 1080, h: 1350 },
  '9:16': { w: 1080, h: 1920 },
  '1.91:1': { w: 1200, h: 630 },
};

// Social handles by platform (footer of the branded frame).
const HANDLES = { ig: '@rrmacademy', x: '@RRM_academy' };

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
// already-composed inner markup (template + optional frame chrome).
export function svgShell({ mode, aspect, alt, body }) {
  const { w, h } = ASPECTS[aspect];
  const bg = color('bg-body', mode);
  const fontFace = `<style>text{font-family:${FONT_UI};} .num{font-family:${FONT_DISPLAY};}</style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${escapeXml(alt)}">`
    + `<title>${escapeXml(alt)}</title><desc>${escapeXml(alt)}</desc>`
    + fontFace
    + `<rect x="0" y="0" width="${w}" height="${h}" fill="${bg}"/>`
    + body
    + `</svg>`;
}

// Composed source provenance string.
export function sourceLine(spec) {
  const s = spec.source || {};
  const id = s.pmid ? `PMID ${s.pmid}` : s.doi ? `DOI ${s.doi}` : (s.url || '');
  return [s.label, id].filter(Boolean).join(', ');
}

// Big-numeral size clamped to both box dimensions so it stays sane at every
// aspect (tall 9:16 must not produce a giant glyph).
function bigFont(box, kw, kh) {
  return Math.round(Math.min(box.w * kw, box.h * kh));
}

// Eyebrow label + provenance line. Coords are box-local; the caller translates.
function eyebrow(spec, mode, x, y) {
  return `<text x="${x}" y="${y}" font-size="34" font-weight="600" letter-spacing="3" fill="${color('text-secondary', mode)}">${escapeXml(spec.eyebrow.toUpperCase())}</text>`;
}
function provenance(spec, mode, x, y, w) {
  return `<line x1="${x}" y1="${y - 30}" x2="${x + w}" y2="${y - 30}" stroke="${color('purple-100', mode)}" stroke-width="2"/>`
    + `<text x="${x}" y="${y}" font-size="26" fill="${color('text-secondary', mode)}">${escapeXml('Source: ' + sourceLine(spec))}</text>`;
}

// Word-wrap a label into multiple lines so it never overflows the content width.
// Returns { svg, lines } so callers can place following elements below it.
function wrapLabel(text, mode, x, y, w, fontSize, fill) {
  const max = Math.max(8, Math.floor(w / (fontSize * 0.54)));
  const lineH = Math.round(fontSize * 1.2);
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const wd of words) {
    if (cur && (cur + ' ' + wd).length > max) { lines.push(cur); cur = wd; }
    else cur = cur ? cur + ' ' + wd : wd;
  }
  if (cur) lines.push(cur);
  const tspans = lines.map((ln, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineH}">${escapeXml(ln)}</tspan>`).join('');
  return { svg: `<text x="${x}" y="${y}" font-size="${fontSize}" fill="${fill}">${tspans}</text>`, lines: lines.length, lineH };
}

// The branded card chrome: top accent bar + wordmark, and a footer band with
// rrmacademy.org + the platform handle. Standalone-only (uses resolved hex).
function frameCard(canvas, box, platform, pad, topBand) {
  const accent = color('purple-700', 'standalone');
  const muted = color('text-secondary', 'standalone');
  const wmH = Math.round(topBand * 0.34);
  const wmY = Math.round((topBand - wmH) / 2) + 8;
  const footTop = box.y + box.h;
  const ruleY = footTop + Math.round((canvas.h - footTop) * 0.30);
  const textY = footTop + Math.round((canvas.h - footTop) * 0.66);
  const handle = HANDLES[platform] || HANDLES.ig;
  return `<rect x="0" y="0" width="${canvas.w}" height="8" fill="${accent}"/>`
    + wordmarkSvg(pad, wmY, wmH)
    + `<line x1="${pad}" y1="${ruleY}" x2="${canvas.w - pad}" y2="${ruleY}" stroke="${color('purple-100', 'standalone')}" stroke-width="2"/>`
    + `<text x="${pad}" y="${textY}" font-size="26" fill="${muted}">rrmacademy.org</text>`
    + `<text x="${canvas.w - pad}" y="${textY}" text-anchor="end" font-size="26" font-weight="600" fill="${accent}">${escapeXml(handle)}</text>`;
}

// ---- Renderers: (spec, { mode, box }) -> { body, alt }. Box-local coords. ----

function renderSingle(spec, { mode, box }) {
  const w = box.w, h = box.h, pad = Math.round(w * 0.07);
  const alt = `${spec.value} ${spec.label}. Source: ${sourceLine(spec)}`;
  const lbl = wrapLabel(spec.label, mode, pad, h * 0.6, w - pad * 2, 40, color('text-primary', mode));
  const srcY = Math.min(Math.round(h * 0.6 + lbl.lines * lbl.lineH + 36), h - Math.round(pad * 0.5));
  const body = eyebrow(spec, mode, pad, pad + 36)
    + `<text x="${pad}" y="${h * 0.5}" class="num" font-size="${bigFont(box, 0.28, 0.34)}" font-weight="600" fill="${color('purple-700', mode)}">${escapeXml(spec.value)}</text>`
    + lbl.svg
    + provenance(spec, mode, pad, srcY, w - pad * 2);
  return { body, alt };
}

function renderDelta(spec, { mode, box }) {
  const w = box.w, h = box.h, pad = Math.round(w * 0.07);
  const accent = color(spec.polarity === 'favorable' ? 'ig-favorable' : spec.polarity === 'unfavorable' ? 'ig-unfavorable' : 'ig-neutral', mode);
  const chevron = spec.direction === 'up' ? '▲' : '▼';
  const tag = spec.polarity === 'favorable' ? 'Favorable' : spec.polarity === 'unfavorable' ? 'Unfavorable' : 'Neutral';
  const alt = `${chevron} ${spec.value} ${spec.label} (${tag}). Source: ${sourceLine(spec)}`;
  const lbl = wrapLabel(spec.label, mode, pad, h * 0.52, w - pad * 2, 40, color('text-primary', mode));
  const tagY = Math.round(h * 0.52 + (lbl.lines - 1) * lbl.lineH + 56);
  const srcY = Math.min(tagY + 60, h - Math.round(pad * 0.5));
  const body = eyebrow(spec, mode, pad, pad + 36)
    + `<text x="${pad}" y="${h * 0.4}" class="num" font-size="${bigFont(box, 0.22, 0.30)}" font-weight="600" fill="${accent}">${escapeXml(chevron + ' ' + spec.value)}</text>`
    + lbl.svg
    + `<text x="${pad}" y="${tagY}" font-size="28" font-weight="600" letter-spacing="2" fill="${accent}">${escapeXml(tag.toUpperCase())}</text>`
    + provenance(spec, mode, pad, srcY, w - pad * 2);
  return { body, alt };
}

function renderBars(spec, { mode, box }) {
  const w = box.w, h = box.h, pad = Math.round(w * 0.07);
  // Bottom-anchored bands so the x-axis labels and the provenance footer never collide.
  const provY = h - Math.round(pad * 0.5);
  const labelsY = provY - 64;
  const plotBottom = labelsY - 34;
  const plotTop = pad + 130, plotH = plotBottom - plotTop;
  const axisMax = spec.unit === '%' ? 100 : Math.max(...spec.bars.map((b) => b.value));
  const n = spec.bars.length;
  const gap = Math.round(w * 0.04);
  const barW = Math.round((w - pad * 2 - gap * (n - 1)) / n);
  const alt = spec.bars.map((b) => `${b.name} ${b.value}${spec.unit}`).join('; ') + `. Source: ${sourceLine(spec)}`;
  let cols = '';
  spec.bars.forEach((b, i) => {
    const x = pad + i * (barW + gap);
    const ratio = axisMax > 0 ? Math.min(b.value / axisMax, 1) : 0;
    const colH = Math.round(plotH * ratio);
    const y = Math.round(plotBottom - colH);
    const fill = b.hero ? color('purple-700', mode) : color('purple-300', mode);
    const valFill = b.hero ? color('purple-700', mode) : color('text-secondary', mode);
    cols += `<rect x="${x}" y="${y}" width="${barW}" height="${colH}" rx="10" fill="${fill}"/>`
      + `<text x="${x + barW / 2}" y="${y - 18}" text-anchor="middle" class="num" font-size="64" font-weight="600" fill="${valFill}">${escapeXml(String(b.value) + spec.unit)}</text>`
      + `<text x="${x + barW / 2}" y="${labelsY}" text-anchor="middle" font-size="30" fill="${color('text-primary', mode)}">${escapeXml(b.name)}</text>`;
  });
  const body = eyebrow(spec, mode, pad, pad + 36)
    + `<text x="${pad}" y="${pad + 84}" font-size="34" fill="${color('text-primary', mode)}">${escapeXml(spec.caption)}</text>`
    + cols
    + provenance(spec, mode, pad, provY, w - pad * 2);
  return { body, alt };
}

function renderRatio(spec, { mode, box }) {
  const w = box.w, h = box.h, pad = Math.round(w * 0.07);
  const provY = h - Math.round(pad * 0.5);
  const alt = `${spec.numerator} in ${spec.denominator} ${spec.label}. Source: ${sourceLine(spec)}`;
  const perRow = Math.min(spec.denominator, 10);
  const rows = Math.ceil(spec.denominator / perRow);
  const dotR = 24, dotGap = 20;
  // Coherent stack: numeral -> dots -> wrapped label, anchored in the upper area.
  const headY = Math.round(h * 0.32);
  const dotsTop = headY + 40;
  let dots = '';
  for (let i = 0; i < spec.denominator; i++) {
    const cx = pad + dotR + (i % perRow) * (dotR * 2 + dotGap);
    const cy = dotsTop + Math.floor(i / perRow) * (dotR * 2 + dotGap);
    const fill = i < spec.numerator ? color('purple-700', mode) : color('purple-100', mode);
    dots += `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${fill}"/>`;
  }
  const dotsBottom = dotsTop + (rows - 1) * (dotR * 2 + dotGap) + dotR;
  const labelY = Math.min(dotsBottom + 66, provY - 120);
  const rlbl = wrapLabel(spec.label, mode, pad, labelY, w - pad * 2, 40, color('text-primary', mode));
  const srcY = Math.min(labelY + rlbl.lines * rlbl.lineH + 40, provY);
  const body = eyebrow(spec, mode, pad, pad + 36)
    + `<text x="${pad}" y="${headY}" class="num" font-size="${bigFont(box, 0.15, 0.20)}" font-weight="600" fill="${color('purple-700', mode)}">${escapeXml(spec.numerator + ' in ' + spec.denominator)}</text>`
    + dots
    + rlbl.svg
    + provenance(spec, mode, pad, srcY, w - pad * 2);
  return { body, alt };
}

// Dispatcher.
const RENDERERS = {};
export function registerRenderer(name, fn) { RENDERERS[name] = fn; }
registerRenderer('single', renderSingle);
registerRenderer('delta', renderDelta);
registerRenderer('bars', renderBars);
registerRenderer('ratio', renderRatio);

export function renderInfographic(spec, opts = {}) {
  const mode = opts.mode || 'inline';
  const aspect = opts.aspect || '1:1';
  const canvas = ASPECTS[aspect];
  if (!canvas) throw new Error(`unknown aspect: ${aspect}`);
  // inline (on-page) is always bare; branded frame is a standalone-export option.
  const frame = mode === 'inline' ? 'none' : (opts.frame || 'none');
  const platform = opts.platform || 'ig';
  const v = validateSpec(spec);
  if (!v.valid) throw new Error(`invalid spec: ${v.errors.join('; ')}`);
  const fn = RENDERERS[spec.template];
  if (!fn) throw new Error(`no renderer for template: ${spec.template}`);

  const pad = Math.round(canvas.w * 0.07);
  let box, chrome = '';
  if (frame === 'branded') {
    if (mode !== 'standalone') throw new Error('branded frame requires standalone mode (resolved hex)');
    // Width-proportional bands, clamped by height so a short aspect (the 1.91:1 card)
    // does not lose most of its content area to the frame.
    const topBand = Math.round(Math.min(canvas.w * 0.115, canvas.h * 0.17));
    const bottomBand = Math.round(Math.min(canvas.w * 0.085, canvas.h * 0.13));
    box = { x: 0, y: topBand, w: canvas.w, h: canvas.h - topBand - bottomBand };
    chrome = frameCard(canvas, box, platform, pad, topBand);
  } else {
    box = { x: 0, y: 0, w: canvas.w, h: canvas.h };
  }
  const { body, alt } = fn(spec, { mode, box });
  const placed = box.y ? `<g transform="translate(0 ${box.y})">${body}</g>` : body;
  return svgShell({ mode, aspect, alt, body: placed + chrome });
}

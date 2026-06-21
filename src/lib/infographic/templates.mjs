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
const HANDLES = { ig: '@rrmacademy', x: '@rrm_academy' };

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

// Footer band: rrmacademy.org + the platform handle. Theme-aware (var() inline,
// hex standalone) so it appears on-page AND on exports.
function footerBand(canvas, footTop, mode, platform, pad) {
  const band = canvas.h - footTop;
  const ruleY = footTop + Math.round(band * 0.30);
  const textY = footTop + Math.round(band * 0.64);
  const handle = HANDLES[platform] || HANDLES.ig;
  return `<line x1="${pad}" y1="${ruleY}" x2="${canvas.w - pad}" y2="${ruleY}" stroke="${color('purple-100', mode)}" stroke-width="2"/>`
    + `<text x="${pad}" y="${textY}" font-size="26" fill="${color('text-secondary', mode)}">rrmacademy.org</text>`
    + `<text x="${canvas.w - pad}" y="${textY}" text-anchor="end" font-size="26" font-weight="600" fill="${color('purple-700', mode)}">${escapeXml(handle)}</text>`;
}

// Top wordmark band (export only): accent bar + RRM wordmark.
function wordmarkBand(canvas, pad, topBand, mode) {
  const wmH = Math.round(topBand * 0.34);
  const wmY = Math.round((topBand - wmH) / 2) + 8;
  return `<rect x="0" y="0" width="${canvas.w}" height="8" fill="${color('purple-700', mode)}"/>`
    + wordmarkSvg(pad, wmY, wmH);
}

// ---- Renderers: (spec, { mode, box }) -> { body, alt }. Box-local coords. ----

// Parse a "62%" style value into a 0-100 number, else null.
function asPercent(value) {
  const m = /^(\d{1,3}(?:\.\d+)?)\s*%$/.exec(String(value).trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

function renderSingle(spec, { mode, box }) {
  const w = box.w, h = box.h, pad = Math.round(w * 0.07);
  const plotW = w - pad * 2;
  const provY = h - Math.round(pad * 0.5);
  const pct = asPercent(spec.value);
  const alt = `${spec.value} ${spec.label}. Source: ${sourceLine(spec)}`;
  // Vertically center the (number + visual) group in the band below the eyebrow.
  const bandTop = pad + 110, bandBottom = provY - 150;
  const midY = Math.round((bandTop + bandBottom) / 2);
  const numFs = Math.round(Math.min(plotW * 0.34, (bandBottom - bandTop) * 0.6));
  const numY = midY - 24;
  let visual = '';
  if (pct != null) {
    // Progress bar filled to the percentage: the data visual.
    const barH = Math.max(28, Math.round(numFs * 0.16));
    const barY = numY + Math.round(numFs * 0.28);
    const fillW = Math.max(Math.round(plotW * (pct / 100)), barH);
    visual = `<rect x="${pad}" y="${barY}" width="${plotW}" height="${barH}" rx="${Math.round(barH / 2)}" fill="${color('purple-100', mode)}"/>`
      + `<rect x="${pad}" y="${barY}" width="${fillW}" height="${barH}" rx="${Math.round(barH / 2)}" fill="${color('purple-700', mode)}"/>`;
  } else {
    // Non-percentage: a filled accent panel behind the value gives it weight.
    const panelH = numFs + 56;
    const panelY = numY - numFs + 8;
    visual = `<rect x="${pad}" y="${panelY}" width="${plotW}" height="${panelH}" rx="22" fill="${color('purple-700', mode)}"/>`;
  }
  const numFill = pct != null ? color('purple-700', mode) : color('bg-body', mode);
  const numEl = pct != null
    ? `<text x="${pad}" y="${numY}" class="num" font-size="${numFs}" font-weight="600" fill="${numFill}">${escapeXml(spec.value)}</text>`
    : `<text x="${w / 2}" y="${numY + 8}" text-anchor="middle" class="num" font-size="${numFs}" font-weight="600" fill="${numFill}">${escapeXml(spec.value)}</text>`;
  const labelY = (pct != null ? numY + Math.round(numFs * 0.28) + Math.max(28, Math.round(numFs * 0.16)) : numY) + 86;
  const lbl = wrapLabel(spec.label, mode, pad, labelY, plotW, 40, color('text-primary', mode));
  const srcY = Math.min(labelY + lbl.lines * lbl.lineH + 36, provY);
  const body = eyebrow(spec, mode, pad, pad + 36) + visual + numEl + lbl.svg + provenance(spec, mode, pad, srcY, plotW);
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
  const provY = h - Math.round(pad * 0.5);
  const plotW = w - pad * 2;
  const axisMax = spec.unit === '%' ? 100 : Math.max(...spec.bars.map((b) => b.value));
  const alt = spec.bars.map((b) => `${b.name} ${b.value}${spec.unit}`).join('; ') + `. Source: ${sourceLine(spec)}`;
  const n = spec.bars.length;
  // Horizontal bars: length encodes the value at every aspect; the number sits inside.
  // Inline name labels (left of each bar) keep rows compact; the bar group is centered
  // with fixed spacing so it never spreads (tall) or crams (short card).
  const nameColW = Math.round(plotW * 0.28);
  const trackX = pad + nameColW;
  const trackW = plotW - nameColW;
  const plotTop = pad + 134;          // below eyebrow + caption
  const plotBottom = provY - 54;      // room for the source line
  const plotAvail = plotBottom - plotTop;
  const gap = 40;
  const barH = Math.min(112, Math.max(34, Math.round((plotAvail - gap * (n - 1)) / n)));
  const groupH = n * barH + gap * (n - 1);
  const startY = plotTop + Math.max(0, Math.round((plotAvail - groupH) / 2));
  let rows = '';
  spec.bars.forEach((b, i) => {
    const barY = startY + i * (barH + gap);
    const midY = Math.round(barY + barH / 2);
    const ratio = axisMax > 0 ? Math.min(b.value / axisMax, 1) : 0;
    const fillW = Math.max(Math.round(trackW * ratio), barH);
    const fill = b.hero ? color('purple-700', mode) : color('purple-300', mode);
    const valStr = String(b.value) + spec.unit;
    const vFs = Math.min(Math.round(barH * 0.58), 60);
    const nameFs = Math.min(Math.round(barH * 0.34), 30);
    const inside = fillW > vFs * 3;
    const vX = inside ? trackX + fillW - Math.round(vFs * 0.45) : trackX + fillW + 22;
    const vAnchor = inside ? 'end' : 'start';
    const vFill = inside ? (b.hero ? color('bg-body', mode) : color('purple-900', mode)) : color('text-primary', mode);
    rows += `<text x="${trackX - 22}" y="${midY + Math.round(nameFs * 0.34)}" text-anchor="end" font-size="${nameFs}" font-weight="600" fill="${color('text-secondary', mode)}">${escapeXml(b.name)}</text>`
      + `<rect x="${trackX}" y="${barY}" width="${trackW}" height="${barH}" rx="${Math.round(barH * 0.18)}" fill="${color('purple-50', mode)}"/>`
      + `<rect x="${trackX}" y="${barY}" width="${fillW}" height="${barH}" rx="${Math.round(barH * 0.18)}" fill="${fill}"/>`
      + `<text x="${vX}" y="${midY + Math.round(vFs * 0.34)}" text-anchor="${vAnchor}" class="num" font-size="${vFs}" font-weight="600" fill="${vFill}">${escapeXml(valStr)}</text>`;
  });
  const body = eyebrow(spec, mode, pad, pad + 36)
    + `<text x="${pad}" y="${pad + 84}" font-size="34" fill="${color('text-primary', mode)}">${escapeXml(spec.caption)}</text>`
    + rows
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
  // The rrmacademy.org + handle footer appears on EVERY render (on-page included, so a
  // screenshot carries attribution). The top wordmark band is export-only (branded).
  const frame = opts.frame || 'none';
  const wantWordmark = frame === 'branded';
  if (wantWordmark && mode !== 'standalone') throw new Error('branded wordmark frame requires standalone mode (resolved hex)');
  const platform = opts.platform || 'ig';
  const v = validateSpec(spec);
  if (!v.valid) throw new Error(`invalid spec: ${v.errors.join('; ')}`);
  const fn = RENDERERS[spec.template];
  if (!fn) throw new Error(`no renderer for template: ${spec.template}`);

  const pad = Math.round(canvas.w * 0.07);
  // Bands clamped by height so a short aspect (the 1.91:1 card) keeps its content area.
  const footerBandH = Math.round(Math.min(canvas.w * 0.085, canvas.h * 0.13));
  const topBand = wantWordmark ? Math.round(Math.min(canvas.w * 0.115, canvas.h * 0.17)) : 0;
  const box = { x: 0, y: topBand, w: canvas.w, h: canvas.h - topBand - footerBandH };
  let chrome = footerBand(canvas, box.y + box.h, mode, platform, pad);
  if (wantWordmark) chrome = wordmarkBand(canvas, pad, topBand, mode) + chrome;
  const { body, alt } = fn(spec, { mode, box });
  const placed = box.y ? `<g transform="translate(0 ${box.y})">${body}</g>` : body;
  return svgShell({ mode, aspect, alt, body: placed + chrome });
}

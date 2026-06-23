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
  // Top of the text hierarchy: largest + darkest. Caption/label below it step lighter.
  return `<text x="${x}" y="${y}" font-size="42" font-weight="600" letter-spacing="2.5" fill="${color('text-primary', mode)}">${escapeXml(spec.eyebrow.toUpperCase())}</text>`;
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
  // One footer attribution (rrmacademy.org). The wordmark carries the brand on branded
  // exports; the social-post caption carries the @handle, so it is not repeated here.
  return `<line x1="${pad}" y1="${ruleY}" x2="${canvas.w - pad}" y2="${ruleY}" stroke="${color('purple-100', mode)}" stroke-width="2"/>`
    + `<text x="${pad}" y="${textY}" font-size="26" fill="${color('text-secondary', mode)}">rrmacademy.org</text>`;
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

// Health Icons "woman" (filled, 48x48 viewBox, public domain, healthicons.org) for the
// people pictograph. Single evenodd path; filled via the <use> that references it.
const HW_WOMAN = 'M28.5 8.5C28.5 10.9853 26.4853 13 24 13C21.5148 13 19.5 10.9853 19.5 8.5C19.5 6.01472 21.5148 4 24 4C26.4853 4 28.5 6.01472 28.5 8.5ZM18.5 21C18.5 23.5306 16.1642 32.0452 15.309 35.0778C15.146 35.6558 15.5244 36.2471 16.1183 36.3364C22.1054 37.2369 25.899 37.2073 31.8856 36.3305C32.4782 36.2438 32.8601 35.6592 32.7021 35.0815C31.8565 31.9898 29.5025 23.1876 29.5 21.0034L29.5 21L29.5 19.4948C29.8976 19.9955 30.2688 20.7401 30.4968 21.5452L30.5188 21.6225C30.6579 22.1136 30.7102 22.2982 30.7594 22.4837C30.789 22.5955 30.8175 22.7075 30.8632 22.887C30.9918 23.3925 31.2565 24.4331 32.0659 27.509C32.347 28.5772 33.4408 29.2153 34.509 28.9341C35.5772 28.653 36.2153 27.5592 35.9342 26.491C35.1642 23.5651 34.8904 22.4916 34.7497 21.94L34.7497 21.9399L34.7497 21.9399C34.6054 21.3744 34.6011 21.3576 34.3454 20.4548C34.0007 19.2383 33.4136 17.986 32.6211 16.993C31.8733 16.0559 30.648 15 29 15H24C24 15 24 15 24 15C24 15 24 15 24 15H19C17.352 15 16.1268 16.0559 15.3789 16.993C14.5864 17.986 13.9993 19.2383 13.6547 20.4548C13.3989 21.3576 13.3946 21.3744 13.2504 21.9399C13.1097 22.4915 12.8359 23.5649 12.0659 26.491C11.7847 27.5592 12.4228 28.653 13.491 28.9341C14.5592 29.2153 15.653 28.5772 15.9342 27.509C16.7436 24.4331 17.0083 23.3925 17.1369 22.887C17.1825 22.7075 17.211 22.5954 17.2407 22.4837C17.2898 22.2983 17.3422 22.1136 17.4813 21.6226L17.4813 21.6224L17.4814 21.6222L17.5032 21.5452C17.7313 20.7401 18.1024 19.9954 18.5 19.4948L18.5 21ZM18.5 42.3877V38.5704C19.9095 38.7792 21.2135 38.9111 22.4875 38.9679L21.4472 42.7824C21.2495 43.5074 20.5458 43.9742 19.8009 43.8745C19.0561 43.7747 18.5 43.1392 18.5 42.3877ZM26.5529 42.7824L25.5108 38.9616C26.7854 38.8998 28.09 38.7642 29.5 38.5566V42.3877C29.5 43.1392 28.944 43.7747 28.1991 43.8745C27.4543 43.9742 26.7506 43.5074 26.5529 42.7824Z';

function renderSingle(spec, { mode, box }) {
  const w = box.w, h = box.h, pad = Math.round(w * 0.07);
  const plotW = w - pad * 2;
  const provY = h - Math.round(pad * 0.5);
  const pct = asPercent(spec.value);
  const alt = `${spec.value} ${spec.label}. Source: ${sourceLine(spec)}`;
  // The NUMBER leads at the top of the card; the visual and a one-line descriptor follow.
  // (No eyebrow above the number: the stat is read first, then explained.)
  const numFs = Math.round(Math.min(plotW * 0.4, h * 0.32));
  const numY = pad + Math.round(numFs * 0.8);
  let visual = '';
  let descY;
  if (pct != null) {
    // People pictograph: 10 figures, filled to the percentage (88% -> 8.8 figures).
    const N = 10;
    const filledFigs = (pct / 100) * N;
    const figW = Math.round((plotW / N) * 0.8);
    const gap = Math.round((plotW - figW * N) / (N - 1));
    const figH = figW;
    const figTop = numY + Math.round(numFs * 0.26);
    const sc = figW / 48;
    const on = color('purple-700', mode), off = color('purple-100', mode);
    const woman = (x, fill) =>
      `<use href="#hw" transform="translate(${x} ${figTop}) scale(${sc})" fill="${fill}"/>`;
    let defs = `<g id="hw"><path fill-rule="evenodd" d="${HW_WOMAN}"/></g>`, figs = '';
    for (let i = 0; i < N; i++) {
      const x = pad + i * (figW + gap);
      const fr = Math.max(0, Math.min(1, filledFigs - i));
      figs += woman(x, off);
      if (fr >= 0.999) figs += woman(x, on);
      else if (fr > 0) {
        const cid = `pf${i}`;
        const fh = Math.round(figH * fr);
        defs += `<clipPath id="${cid}"><rect x="${x}" y="${figTop + figH - fh}" width="${figW}" height="${fh + 2}"/></clipPath>`;
        figs += `<g clip-path="url(#${cid})">${woman(x, on)}</g>`;
      }
    }
    visual = (defs ? `<defs>${defs}</defs>` : '') + figs;
    descY = figTop + figH + 66;
  } else {
    // Non-percentage: a filled accent panel behind the value gives it weight.
    const panelH = numFs + 52;
    const panelY = numY - Math.round(numFs * 0.78);
    visual = `<rect x="${pad}" y="${panelY}" width="${plotW}" height="${panelH}" rx="22" fill="${color('purple-700', mode)}"/>`;
    descY = panelY + panelH + 64;
  }
  const numFill = pct != null ? color('purple-700', mode) : color('bg-body', mode);
  const numEl = pct != null
    ? `<text x="${pad}" y="${numY}" class="num" font-size="${numFs}" font-weight="600" fill="${numFill}">${escapeXml(spec.value)}</text>`
    : `<text x="${w / 2}" y="${numY}" text-anchor="middle" class="num" font-size="${numFs}" font-weight="600" fill="${numFill}">${escapeXml(spec.value)}</text>`;
  const lbl = wrapLabel(spec.label, mode, pad, descY, plotW, 40, color('text-primary', mode));
  const srcY = Math.min(descY + lbl.lines * lbl.lineH + 36, provY);
  const body = visual + numEl + lbl.svg + provenance(spec, mode, pad, srcY, plotW);
  return { body, alt };
}

function renderDelta(spec, { mode, box }) {
  const w = box.w, h = box.h, pad = Math.round(w * 0.07);
  const accent = color(spec.polarity === 'favorable' ? 'ig-favorable' : spec.polarity === 'unfavorable' ? 'ig-unfavorable' : 'ig-neutral', mode);
  const tag = spec.polarity === 'favorable' ? 'Favorable' : spec.polarity === 'unfavorable' ? 'Unfavorable' : 'Neutral';
  const alt = `${spec.direction === 'up' ? 'up' : 'down'} ${spec.value} ${spec.label} (${tag}). Source: ${sourceLine(spec)}`;

  // --- Anchor the vertical stack from the eyebrow down so elements never overlap
  // at any aspect, with the short 1.91:1 card as the binding case.
  const eyebrowY = pad + 36;                           // eyebrow baseline (box-local)
  const valueGap = 24;                                 // cap clearance below eyebrow
  const srcY = h - Math.round(pad * 0.5);             // provenance baseline (fixed at bottom)

  // Pre-compute label metrics at fixed 40px so we know how tall the label band is.
  const plotW = w - pad * 2;
  const labelFs = 40;
  const labelLineH = Math.round(labelFs * 1.2);        // 48
  // Measure line count with a placeholder y (will re-place below).
  const lblMeasure = wrapLabel(spec.label, mode, pad, 0, plotW, labelFs, color('text-primary', mode));
  const labelBand = (lblMeasure.lines - 1) * labelLineH; // extra height beyond first line

  // Fixed vertical budget below the value text's descender:
  //   gap-to-label(20) + labelBand + gap-to-tag(48) + tag-height(28) + gap-to-src(60)
  const belowValueBudget = 20 + labelBand + 48 + 28 + 60;

  // Natural unclamped font size.
  const naturalFs = bigFont(box, 0.22, 0.30);
  // Available height from eyebrow-bottom to srcY for the entire value-to-src stack:
  //   valueGap + cap(vFs*0.72) + desc(vFs*0.28) + belowValueBudget
  //   = valueGap + vFs + belowValueBudget <= srcY - eyebrowY
  const available = srcY - eyebrowY - valueGap - belowValueBudget;
  const vFs = Math.max(48, Math.min(naturalFs, available));  // never below 48px

  // Place the value row below the eyebrow.
  const valueBaseline = Math.round(eyebrowY + valueGap + vFs * 0.72);

  // Place the label strictly below the value descender.
  const labelY = Math.round(valueBaseline + vFs * 0.28 + 20);
  const lbl = wrapLabel(spec.label, mode, pad, labelY, plotW, labelFs, color('text-primary', mode));

  // Tag and source fall below the label.
  const tagY = Math.round(labelY + (lbl.lines - 1) * lbl.lineH + 48);

  const body = eyebrow(spec, mode, pad, eyebrowY)
    + (() => {
        const t = Math.round(vFs * 0.6);                 // triangle box size
        const topY = Math.round(valueBaseline - vFs * 0.72);
        const up = spec.direction === 'up';
        const tri = up
          ? `<polygon points="${pad},${topY + t} ${pad + t},${topY + t} ${pad + t / 2},${topY}" fill="${accent}"/>`
          : `<polygon points="${pad},${topY} ${pad + t},${topY} ${pad + t / 2},${topY + t}" fill="${accent}"/>`;
        const vx = pad + t + Math.round(vFs * 0.3);
        return tri + `<text x="${vx}" y="${valueBaseline}" class="num" font-size="${vFs}" font-weight="600" fill="${accent}">${escapeXml(spec.value)}</text>`;
      })()
    + lbl.svg
    + `<text x="${pad}" y="${tagY}" font-size="28" font-weight="600" letter-spacing="2" fill="${accent}">${escapeXml(tag.toUpperCase())}</text>`
    + provenance(spec, mode, pad, srcY, plotW);
  return { body, alt };
}

function renderBars(spec, { mode, box }) {
  const w = box.w, h = box.h, pad = Math.round(w * 0.07);
  const provY = h - Math.round(pad * 0.5);
  const plotW = w - pad * 2;
  const axisMax = spec.unit === '%' ? 100 : Math.max(...spec.bars.map((b) => b.value));
  const alt = spec.bars.map((b) => `${b.name} ${b.value}${spec.unit}`).join('; ') + `. Source: ${sourceLine(spec)}`;
  const n = spec.bars.length;
  // Orientation follows the box: tall boxes (story 9:16) get VERTICAL columns that use
  // the height; wide/short boxes (card, on-page, square) get HORIZONTAL bars.
  const vertical = h / w >= 1.3;
  let rows = '';
  if (vertical) {
    const plotTop = pad + 142;
    const plotBottom = provY - 132;         // room for the name labels (below cols) AND the source
    const plotH = plotBottom - plotTop;
    const gap = Math.round(w * 0.06);
    const colW = Math.round((plotW - gap * (n - 1)) / n);
    spec.bars.forEach((b, i) => {
      const x = pad + i * (colW + gap);
      const ratio = axisMax > 0 ? Math.min(b.value / axisMax, 1) : 0;
      const colH = Math.max(Math.round(plotH * ratio), 12);
      const y = plotBottom - colH;
      const fill = b.hero ? color('purple-700', mode) : color('purple-300', mode);
      const valStr = String(b.value) + spec.unit;
      const vFs = Math.min(Math.round(colW * 0.32), 92);
      const fitsInside = colH > vFs * 1.7;
      const vY = fitsInside ? y + vFs + 22 : y - 26;
      const vFill = fitsInside ? (b.hero ? color('bg-body', mode) : color('purple-900', mode)) : color('text-primary', mode);
      const cxc = x + colW / 2;
      rows += `<rect x="${x}" y="${plotTop}" width="${colW}" height="${plotH}" rx="14" fill="${color('purple-50', mode)}"/>`
        + `<rect x="${x}" y="${y}" width="${colW}" height="${colH}" rx="14" fill="${fill}"/>`
        + `<text x="${cxc}" y="${vY}" text-anchor="middle" class="num" font-size="${vFs}" font-weight="600" fill="${vFill}">${escapeXml(valStr)}</text>`
        + `<text x="${cxc}" y="${plotBottom + 50}" text-anchor="middle" font-size="32" font-weight="600" fill="${color('text-secondary', mode)}">${escapeXml(b.name)}</text>`;
    });
  } else {
    // Horizontal bars: inline name labels keep rows compact; the group is centered with
    // fixed spacing so it never spreads (tall) or crams (short card).
    const nameColW = Math.round(plotW * 0.28);
    const trackX = pad + nameColW;
    const trackW = plotW - nameColW;
    const plotTop = pad + 110;
    const plotBottom = provY - 46;
    const plotAvail = plotBottom - plotTop;
    const gap = Math.round(Math.min(40, plotAvail * 0.16));
    const barH = Math.min(140, Math.max(34, Math.round((plotAvail - gap * (n - 1)) / n)));
    const groupH = n * barH + gap * (n - 1);
    const startY = plotTop + Math.max(0, Math.round((plotAvail - groupH) / 2));
    spec.bars.forEach((b, i) => {
      const barY = startY + i * (barH + gap);
      const midY = Math.round(barY + barH / 2);
      const ratio = axisMax > 0 ? Math.min(b.value / axisMax, 1) : 0;
      const fillW = Math.max(Math.round(trackW * ratio), barH);
      const fill = b.hero ? color('purple-700', mode) : color('purple-300', mode);
      const valStr = String(b.value) + spec.unit;
      const vFs = Math.min(Math.round(barH * 0.58), 60);
      const nameFs = Math.min(Math.round(barH * 0.34), 30);
      // Names + values are one color, matching the headline (visual simplicity). The bar
      // FILL carries the polarity (hero vs comparator), not the text.
      const txt = color('text-primary', mode);
      // Prefer the value OUTSIDE the bar; fall inside only when a long bar leaves no room.
      const wOut = valStr.length * Math.round(vFs * 0.6);
      const inside = fillW + 28 + wOut > trackW;
      const vX = inside ? trackX + fillW - Math.round(vFs * 0.45) : trackX + fillW + 24;
      const vAnchor = inside ? 'end' : 'start';
      const vFill = inside ? (b.hero ? color('bg-body', mode) : txt) : txt;
      rows += `<text x="${trackX - 22}" y="${midY + Math.round(nameFs * 0.34)}" text-anchor="end" font-size="${nameFs}" font-weight="600" fill="${txt}">${escapeXml(b.name)}</text>`
        + `<rect x="${trackX}" y="${barY}" width="${trackW}" height="${barH}" rx="${Math.round(barH * 0.18)}" fill="none" stroke="${color('purple-300', mode)}" stroke-width="2"/>`
        + `<rect x="${trackX}" y="${barY}" width="${fillW}" height="${barH}" rx="${Math.round(barH * 0.18)}" fill="${fill}"/>`
        + `<text x="${vX}" y="${midY + Math.round(vFs * 0.34)}" text-anchor="${vAnchor}" class="num" font-size="${vFs}" font-weight="600" fill="${vFill}">${escapeXml(valStr)}</text>`;
    });
  }
  const body = eyebrow(spec, mode, pad, pad + 36)
    + `<text x="${pad}" y="${pad + 84}" font-size="34" fill="${color('text-secondary', mode)}">${escapeXml(spec.caption)}</text>`
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
  const footerBandH = Math.round(Math.min(canvas.w * 0.085, canvas.h * 0.115));
  const topBand = wantWordmark ? Math.round(Math.min(canvas.w * 0.115, canvas.h * 0.15)) : 0;
  const box = { x: 0, y: topBand, w: canvas.w, h: canvas.h - topBand - footerBandH };
  let chrome = footerBand(canvas, box.y + box.h, mode, platform, pad);
  if (wantWordmark) chrome = wordmarkBand(canvas, pad, topBand, mode) + chrome;
  const { body, alt } = fn(spec, { mode, box });
  const placed = box.y ? `<g transform="translate(0 ${box.y})">${body}</g>` : body;
  return svgShell({ mode, aspect, alt, body: placed + chrome });
}

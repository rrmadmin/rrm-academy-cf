#!/usr/bin/env node
/**
 * css-audit — programmatic CSS drift & token-adherence sweep for rrm-academy-cf.
 *
 * Detects, across src/styles/*.css, all .astro <style> blocks, functions/
 * template-literal CSS, and inline style= attributes:
 *
 *   1. undefined-var        var(--x) where --x is defined nowhere in the project.
 *                           With a fallback this renders silently wrong (the
 *                           members-page dark-mode bug class); without one the
 *                           declaration is invalid at computed-value time.
 *   2. fallback-divergence  var(--x, F) where --x IS defined but F differs from
 *                           the token's light value. Dead, misleading fallback.
 *   3. raw-color            Color literals outside token definitions. Classified
 *                           as tokenizable (exact match to a token), near-token
 *                           (close to one), or off-palette (brand violation).
 *   4. dark-unthemed        Theme-sensitive raw colors (near-white backgrounds,
 *                           near-black text, light borders) in rules with no
 *                           [data-theme] override anywhere → white-card-in-dark-
 *                           mode breakage.
 *   5. raw-px-spacing       px values in margin/padding/gap. On the --space
 *                           scale → tokenizable; off-scale → spacing drift.
 *   6. type-scale           font-size values outside the global.css +
 *                           design-system.json vocabulary; px-unit font sizes.
 *   7. line-height-drift    line-height values outside the global vocabulary.
 *   8. selector-divergence  The same selector styled differently in 2+ files
 *                           (page-to-page variation of "the same" element).
 *   9. token-shadowing      Page/component redefines a global token name.
 *  10. inline-style         style="..." attributes bypassing the system.
 *
 * Output: findings JSON + ranked markdown remediation report.
 * Ranking: severity weight x file reach (global/layout=5, component=3, page=1).
 *
 * Usage: node scripts/css-audit/audit.mjs [--json out.json] [--md out.md]
 * Exit code is always 0 (audit, not a gate).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
function argVal(flag, dflt) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const OUT_JSON = argVal('--json', null);
const OUT_MD = argVal('--md', null);

// ---------------------------------------------------------------------------
// Source collection
// ---------------------------------------------------------------------------

const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git', '.claude', '.superpowers', '.astro']);

function walk(dir, exts, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), exts, out);
    } else if (exts.some((x) => e.name.endsWith(x))) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function rel(p) { return path.relative(ROOT, p); }

function lineOfIndex(text, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Extract CSS chunks from a file. Returns [{css, lineOffset, kind}] */
function extractCss(file, text) {
  const chunks = [];
  if (file.endsWith('.css')) {
    chunks.push({ css: text, lineOffset: 0, kind: 'css' });
    return chunks;
  }
  // <style ...> blocks (astro)
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = styleRe.exec(text))) {
    const bodyStart = m.index + m[0].indexOf('>') + 1;
    chunks.push({ css: m[1], lineOffset: lineOfIndex(text, bodyStart) - 1, kind: 'style-block' });
  }
  // CSS embedded in JS template literals (functions/): best-effort — same regex,
  // already covered above when the literal contains a full <style> element.
  return chunks;
}

/** Extract inline style attributes (outside <style> blocks): style="...", style='...', style={`...`}, style={"..."} */
function extractInlineStyles(file, text) {
  if (file.endsWith('.css')) return [];
  const out = [];
  const re = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`\s*\}|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\})/g;
  let m;
  while ((m = re.exec(text))) {
    const val = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
    if (!val.trim()) continue;
    // Custom-property-only style attrs (e.g. style={`--card-accent: ${c}`}) are the
    // blessed token-injection pattern, not drift.
    const propsOnly = val.split(';').map((s) => s.trim()).filter(Boolean);
    const setsRealProps = propsOnly.some((p) => !p.startsWith('--'));
    if (!setsRealProps) continue;
    out.push({ value: val, line: lineOfIndex(text, m.index) });
  }
  return out;
}

/** Custom properties SET in a file's markup/JS (style attrs, template literals, setProperty). */
function markupSetTokens(file, text) {
  if (file.endsWith('.css')) return new Set();
  // strip <style> blocks so CSS declarations don't double-count
  const stripped = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
  const names = new Set();
  for (const m of stripped.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) names.add(m[1]);
  for (const m of stripped.matchAll(/setProperty\(\s*['"](--[a-zA-Z0-9_-]+)['"]/g)) names.add(m[1]);
  return names;
}

// ---------------------------------------------------------------------------
// Parse all sources
// ---------------------------------------------------------------------------

const sourceFiles = [
  ...walk(path.join(ROOT, 'src'), ['.css', '.astro']),
  ...walk(path.join(ROOT, 'functions'), ['.js']),
].sort();

const parsed = []; // {file, root (postcss), lineOffset}
const inlineStyles = []; // {file, line, value}
const parseErrors = [];
const markupTokens = new Map(); // rel(file) -> Set of --names set in markup/JS

for (const file of sourceFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const chunk of extractCss(file, text)) {
    try {
      const root = postcss.parse(chunk.css, { from: file });
      parsed.push({ file, root, lineOffset: chunk.lineOffset });
    } catch (err) {
      parseErrors.push({ file: rel(file), error: String(err.message || err) });
    }
  }
  for (const s of extractInlineStyles(file, text)) {
    inlineStyles.push({ file, ...s });
  }
  const mt = markupSetTokens(file, text);
  if (mt.size) markupTokens.set(rel(file), mt);
}

// ---------------------------------------------------------------------------
// Token registry
// ---------------------------------------------------------------------------

/** name -> [{file, line, selector, value, theme}] */
const tokenDefs = new Map();
/** light-theme (base) value per token name */
const tokenLight = new Map();
const tokenDark = new Map();

function themeOfRule(rule) {
  for (let n = rule; n; n = n.parent) {
    const sel = n.selector || (n.params ? `@${n.name} ${n.params}` : '');
    if (/data-theme=["']?dark/.test(sel)) return 'dark';
    if (/data-theme=["']?eink/.test(sel)) return 'eink';
  }
  return 'light';
}

function declLine(p, decl) {
  return (decl.source?.start?.line || 0) + p.lineOffset;
}

for (const p of parsed) {
  p.root.walkDecls((decl) => {
    if (!decl.prop.startsWith('--')) return;
    const theme = decl.parent?.selector ? themeOfRule(decl.parent) : 'light';
    const entry = {
      file: rel(p.file),
      line: declLine(p, decl),
      selector: decl.parent?.selector || '(at-rule)',
      value: decl.value.trim(),
      theme,
    };
    if (!tokenDefs.has(decl.prop)) tokenDefs.set(decl.prop, []);
    tokenDefs.get(decl.prop).push(entry);
    if (theme === 'light' && !tokenLight.has(decl.prop)) tokenLight.set(decl.prop, entry.value);
    if (theme === 'dark' && !tokenDark.has(decl.prop)) tokenDark.set(decl.prop, entry.value);
  });
}

const GLOBAL_TOKEN_FILES = new Set(['src/styles/global.css', 'src/styles/app-shell.css']);
const isSiteWideFile = (f) => f.startsWith('src/styles/') || f.startsWith('src/layouts/');

/** Tokens with a definition in site-wide CSS (global sheets / layouts). */
const siteWideTokens = new Set(
  [...tokenDefs.entries()]
    .filter(([, defs]) => defs.some((d) => isSiteWideFile(d.file)))
    .map(([name]) => name),
);
const globalTokenNames = new Set(
  [...tokenDefs.entries()]
    .filter(([, defs]) => defs.some((d) => GLOBAL_TOKEN_FILES.has(d.file)))
    .map(([name]) => name),
);

/** rel(file) -> Set of token names defined in that file's own CSS. */
const fileCssTokens = new Map();
for (const [name, defs] of tokenDefs) {
  for (const d of defs) {
    if (!fileCssTokens.has(d.file)) fileCssTokens.set(d.file, new Set());
    fileCssTokens.get(d.file).add(name);
  }
}

/**
 * Astro page/component styles are scoped per file, and functions/ emit
 * standalone HTML that never loads global.css. A var(--x) in file F resolves iff:
 *   - F is not under functions/ AND --x is defined in site-wide CSS, or
 *   - --x is defined in F's own CSS, or
 *   - --x is set in F's own markup/JS (style attr, setProperty).
 */
function resolvesInFile(name, file) {
  if (!file.startsWith('functions/') && siteWideTokens.has(name)) return true;
  if (fileCssTokens.get(file)?.has(name)) return true;
  if (markupTokens.get(file)?.has(name)) return true;
  return false;
}

/** Other files that define/set a token (for parent-supplied component heuristic + messages). */
function definedElsewhere(name, file) {
  const cssFiles = (tokenDefs.get(name) || []).map((d) => d.file).filter((f) => f !== file && !isSiteWideFile(f));
  const markupFiles = [...markupTokens.entries()].filter(([f, s]) => f !== file && s.has(name)).map(([f]) => f);
  return [...new Set([...cssFiles, ...markupFiles])];
}

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function parseColorLiteral(str) {
  const s = str.trim().toLowerCase();
  if (s.startsWith('#')) return hexToRgb(s);
  let m = s.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  if (s === 'white') return [255, 255, 255];
  if (s === 'black') return [0, 0, 0];
  return null;
}

function colorDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** Build palette: token name -> rgb, from BOTH light and dark token values so
 *  legitimate dark-override literals match their tokens instead of reading off-palette. */
const palette = [];
for (const [name, val] of tokenLight) {
  const rgb = parseColorLiteral(val);
  if (rgb) palette.push({ name, rgb, raw: val });
}
for (const [name, val] of tokenDark) {
  const rgb = parseColorLiteral(val);
  if (rgb) palette.push({ name: `${name} (dark)`, rgb, raw: val });
}

function nearestToken(rgb) {
  let best = null;
  for (const t of palette) {
    const d = colorDist(rgb, t.rgb);
    if (!best || d < best.d) best = { ...t, d };
  }
  return best;
}

// ---------------------------------------------------------------------------
// var() reference parser (balanced parens for fallbacks)
// ---------------------------------------------------------------------------

function parseVarRefs(value) {
  const refs = [];
  let i = 0;
  while ((i = value.indexOf('var(', i)) !== -1) {
    let depth = 1;
    let j = i + 4;
    while (j < value.length && depth > 0) {
      if (value[j] === '(') depth++;
      else if (value[j] === ')') depth--;
      j++;
    }
    const inner = value.slice(i + 4, j - 1);
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? null : inner.slice(comma + 1).trim();
    if (name.startsWith('--')) refs.push({ name, fallback });
    i = j;
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Vocabularies (from global.css + design-system.json)
// ---------------------------------------------------------------------------

const designSystem = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'docs/design/design-system.json'), 'utf8'),
);

const SPACE_SCALE_PX = new Set([4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96]);
const SPACE_TOKEN_BY_PX = {
  4: '--space-1', 8: '--space-2', 12: '--space-3', 16: '--space-4', 20: '--space-5',
  24: '--space-6', 32: '--space-8', 40: '--space-10', 48: '--space-12', 64: '--space-16', 96: '--space-24',
};

const fontSizeVocab = new Set();
const lineHeightVocab = new Set();
for (const p of parsed) {
  if (!GLOBAL_TOKEN_FILES.has(rel(p.file))) continue;
  p.root.walkDecls((decl) => {
    if (decl.prop === 'font-size') fontSizeVocab.add(normalizeVal(decl.value));
    if (decl.prop === 'line-height') lineHeightVocab.add(normalizeVal(decl.value));
  });
}
const scale = designSystem.typography?.scale || {};
for (const def of Object.values(scale)) {
  if (def.fontSize) fontSizeVocab.add(normalizeVal(String(def.fontSize)));
  if (def.fontSizeMobile) fontSizeVocab.add(normalizeVal(String(def.fontSizeMobile)));
  if (def.lineHeight) lineHeightVocab.add(normalizeVal(String(def.lineHeight)));
}

// Shipped font weights (per @fontsource imports: Cormorant Garamond 400/600, Inter 400/500/600).
// Anything else renders browser-synthesized faux bold/light — smeared letterforms.
const SHIPPED_WEIGHTS = new Set(['400', '500', '600', 'normal', 'inherit']);

// Documented radii: --radius-sm 4px, --radius-md 8px, --radius-lg 16px, --radius-pill 9999px.
const RADIUS_TOKEN_BY_PX = { 4: '--radius-sm', 8: '--radius-md', 16: '--radius-lg', 9999: '--radius-pill' };
const RADIUS_NEUTRAL = new Set(['0', '50%', '100%', 'inherit', 'initial']);

// Documented breakpoints (STYLE-GUIDE.md Responsive Breakpoints).
const DOCUMENTED_BREAKPOINTS = new Set([640, 768, 769, 1024]);

// Email templates require inline styles; exempt from the inline-style category only.
const INLINE_STYLE_EXEMPT_FILES = new Set(['functions/api/partners/_emails.js']);

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const findings = [];
const SEV_WEIGHT = { critical: 10, high: 5, medium: 2, low: 1 };

function reachOf(file) {
  if (file.startsWith('src/styles/') || file.startsWith('src/layouts/')) return 5;
  if (file.startsWith('src/components/')) return 3;
  if (file.startsWith('src/pages/admin/') || file.startsWith('src/pages/dev/')) return 0.5; // internal, noindex surfaces
  // dynamic route templates render hundreds-to-thousands of live pages (library 3000+)
  if (file.startsWith('src/pages/') && file.includes('[')) return 4;
  return 1;
}

function add(f) {
  findings.push({ ...f, score: SEV_WEIGHT[f.severity] * reachOf(f.file) });
}

const SPACING_PROPS = /^(margin|padding)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$|^(gap|row-gap|column-gap)$/;
const COLOR_PROPS = /^(color|background|background-color|border(-(top|right|bottom|left))?(-color)?|outline-color|box-shadow|fill|stroke|caret-color|text-decoration-color)$/;

// value-distribution histograms (drift quantification, independent of findings)
const hist = {
  fontSize: new Map(), lineHeight: new Map(), borderRadius: new Map(), fontWeight: new Map(),
  transitionDuration: new Map(), zIndex: new Map(), mediaBreakpoint: new Map(),
};
function bump(map, v) { map.set(v, (map.get(v) || 0) + 1); }

const isTokenDefFile = (file, decl) => decl.prop.startsWith('--');

// Track selector -> file -> Set("prop:value") for divergence check
const selectorMap = new Map();

// Per-file: class names that appear in any [data-theme="dark"]-scoped rule.
// Used to suppress dark-unthemed findings when the page ships its own dark override
// (the repo's blessed page-local dark-theming pattern).
const darkOverriddenClasses = new Map(); // rel(file) -> Set<className>
for (const p of parsed) {
  const file = rel(p.file);
  p.root.walkRules((rule) => {
    if (!rule.selector) return;
    if (themeOfRule(rule) === 'light') return;
    for (const m of rule.selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
      if (!darkOverriddenClasses.has(file)) darkOverriddenClasses.set(file, new Set());
      darkOverriddenClasses.get(file).add(m[1]);
    }
  });
}

for (const p of parsed) {
  const file = rel(p.file);
  const isGlobalSheet = GLOBAL_TOKEN_FILES.has(file);

  p.root.walkDecls((decl) => {
    const line = declLine(p, decl);
    const selector = decl.parent?.selector || '(at-rule)';
    const value = decl.value;
    const prop = decl.prop;
    const isTokenDef = prop.startsWith('--');
    const inPrint = (() => {
      for (let n = decl.parent; n; n = n.parent) {
        if (n.type === 'atrule' && n.name === 'media' && /print/.test(n.params)) return true;
      }
      return false;
    })();

    if (prop === 'font-size') bump(hist.fontSize, value.trim());
    if (prop === 'line-height') bump(hist.lineHeight, value.trim());
    if (prop === 'border-radius') bump(hist.borderRadius, value.trim());
    if (prop === 'font-weight') bump(hist.fontWeight, value.trim());
    if (prop === 'z-index') bump(hist.zIndex, value.trim());
    if (/^(transition|transition-duration|animation|animation-duration)$/.test(prop)) {
      for (const m of value.matchAll(/(\d*\.?\d+m?s)\b/g)) bump(hist.transitionDuration, m[1]);
    }

    // --- 9. token-shadowing: page redefines a global token name
    if (isTokenDef && !isGlobalSheet && globalTokenNames.has(prop)) {
      add({
        category: 'token-shadowing', severity: 'medium', file, line, selector, prop, value,
        message: `Redefines global token ${prop} locally`,
        suggestion: `Rename the local property or intentionally document the override`,
      });
    }

    // --- 1+2. var() refs (scope-aware: Astro styles are per-file; functions/ HTML never loads global.css)
    for (const ref of parseVarRefs(value)) {
      if (!resolvesInFile(ref.name, file)) {
        const colorish = COLOR_PROPS.test(prop);
        const elsewhere = definedElsewhere(ref.name, file);
        const isComponent = file.startsWith('src/components/');
        if (isComponent && elsewhere.length) {
          // A consuming page may inject this token via markup — flag for review, not as breakage.
          add({
            category: 'undefined-var', kind: 'parent-supplied', severity: 'low',
            file, line, selector, prop, value,
            message: `var(${ref.name}) not defined in this component or site-wide; set in ${elsewhere.slice(0, 3).join(', ')} — verify every consumer supplies it`,
            suggestion: `Add a site-wide default for ${ref.name} or document the contract`,
          });
        } else {
          add({
            category: 'undefined-var',
            severity: colorish ? 'critical' : 'high',
            file, line, selector, prop, value,
            message: `var(${ref.name}) does not resolve on this page${elsewhere.length ? ` (only defined in ${elsewhere.slice(0, 3).join(', ')}, which does not apply here)` : ''}${ref.fallback ? ` — fallback "${ref.fallback}" always wins (silent, theme-blind)` : ' — declaration is invalid at computed-value time'}`,
            suggestion: guessTokenSuggestion(ref.name, ref.fallback),
          });
        }
      } else if (ref.fallback) {
        const localDef = fileCssTokens.get(file)?.has(ref.name)
          ? tokenDefs.get(ref.name).find((d) => d.file === file)?.value
          : null;
        const effective = localDef ?? tokenLight.get(ref.name);
        if (effective && normalizeVal(ref.fallback) !== normalizeVal(effective)) {
          add({
            category: 'fallback-divergence', severity: 'low', file, line, selector, prop, value,
            message: `Fallback "${ref.fallback}" diverges from defined ${ref.name}: ${effective} (fallback is dead code, misleading)`,
            suggestion: `Drop the fallback: var(${ref.name})`,
          });
        }
      }
    }

    if (isTokenDef) return; // token definitions themselves are exempt below

    const valueNoVars = value.replace(/var\([^)]*(?:\([^)]*\)[^)]*)*\)/g, ''); // strip var() incl. fallbacks

    // --- 3+4. raw colors
    const colorLits = [
      ...valueNoVars.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
      ...valueNoVars.matchAll(/\brgba?\([^)]*\)/g),
      ...(/^(color|background(-color)?|border-color)$/.test(prop) && /^(white|black)$/i.test(valueNoVars.trim())
        ? [[valueNoVars.trim()]] : []),
    ].map((m) => m[0]);

    for (const lit of colorLits) {
      const rgb = parseColorLiteral(lit);
      if (!rgb) continue;
      const isShadowAlpha = /^rgba?\(\s*(0|31|255)\s*,/.test(lit) && /shadow/.test(prop);
      const near = nearestToken(rgb);
      let kind, severity, suggestion;
      if (near && near.d === 0) {
        kind = 'tokenizable'; severity = 'medium';
        suggestion = `Use var(${near.name}) instead of ${lit}`;
      } else if (near && near.d <= 32) {
        kind = 'near-token'; severity = 'medium';
        suggestion = `${lit} is within ${Math.round(near.d)} of ${near.name} (${near.raw}) — align to the token`;
      } else if (isShadowAlpha) {
        kind = 'shadow-alpha'; severity = 'low';
        suggestion = `Consider --shadow-sm/md/lg tokens`;
      } else {
        kind = 'off-palette'; severity = 'high';
        suggestion = `${lit} matches no design token (nearest: ${near ? `${near.name} at distance ${Math.round(near.d)}` : 'none'}) — off-brand color`;
      }
      add({
        category: 'raw-color', kind, severity, file, line, selector, prop, value,
        message: `Raw color ${lit} in ${prop}`, suggestion,
      });

      // dark-unthemed: theme-sensitive raw color with no dark override path.
      // Skips: print styles, global sheets (they carry their own theme blocks),
      // rules already scoped to dark/eink, low-alpha overlays, and selectors whose
      // classes the same file re-themes under [data-theme="dark"].
      if (!inPrint && !isGlobalSheet && COLOR_PROPS.test(prop) && themeOfRule(decl.parent) === 'light') {
        const alphaMatch = lit.match(/rgba\([^)]*,\s*(0?\.\d+|\d*\.?\d+)\s*\)/);
        const alpha = alphaMatch ? parseFloat(alphaMatch[1]) : 1;
        const darkSet = darkOverriddenClasses.get(file);
        const hasDarkOverride = darkSet && [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].some((m) => darkSet.has(m[1]));
        const isLightBg = /background/.test(prop) && rgb[0] + rgb[1] + rgb[2] > 600 && alpha >= 0.5;
        const isDarkText = prop === 'color' && rgb[0] + rgb[1] + rgb[2] < 240 && alpha >= 0.5;
        const isLightBorder = /border/.test(prop) && rgb[0] + rgb[1] + rgb[2] > 600 && alpha >= 0.5;
        if ((isLightBg || isDarkText || isLightBorder) && !hasDarkOverride) {
          add({
            category: 'dark-unthemed', severity: 'high', file, line, selector, prop, value,
            message: `Hardcoded ${isLightBg ? 'light background' : isDarkText ? 'dark text color' : 'light border'} ${lit} — renders unchanged in dark mode`,
            suggestion: `Use a semantic token (--bg-surface / --text-primary / --border-color) so dark theme applies`,
          });
        }
      }
    }

    // --- 5. raw px/rem spacing (calc() arguments are stripped, not exempted)
    if (SPACING_PROPS.test(prop)) {
      const spacingScan = valueNoVars.replace(/calc\([^)]*(?:\([^)]*\)[^)]*)*\)/g, '');
      const seen = new Set();
      for (const m of spacingScan.matchAll(/(-?\d*\.?\d+)(px|rem)\b/g)) {
        const raw = parseFloat(m[1]);
        const negative = raw < 0;
        const px = Math.abs(m[2] === 'rem' ? raw * 16 : raw);
        const key = `${px}:${m[2]}`;
        if (px === 0 || seen.has(key)) continue;
        seen.add(key);
        const unit = m[2];
        if (SPACE_SCALE_PX.has(px)) {
          add({
            category: 'raw-px-spacing', kind: 'tokenizable', severity: 'low', file, line, selector, prop, value,
            message: `${Math.abs(raw)}${unit} (= ${px}px) is on the spacing scale but hardcoded`,
            suggestion: negative
              ? `Negative offset: use calc(-1 * var(${SPACE_TOKEN_BY_PX[px]}))`
              : `Use var(${SPACE_TOKEN_BY_PX[px]})`,
          });
        } else if (px > 2) {
          add({
            category: 'raw-px-spacing', kind: 'off-scale', severity: 'medium', file, line, selector, prop, value,
            message: `${Math.abs(raw)}${unit} (= ${px}px) is OFF the 4px spacing scale (drift)`,
            suggestion: `Snap to nearest scale step (${nearestSpace(px)})`,
          });
        }
      }
    }

    // --- 11. font-weight the shipped fonts don't support (faux bold/light)
    if (prop === 'font-weight' && !SHIPPED_WEIGHTS.has(value.trim()) && !value.includes('var(')) {
      add({
        category: 'font-weight-unsupported', severity: 'medium', file, line, selector, prop, value,
        message: `font-weight ${value.trim()} has no shipped font file (Cormorant 400/600, Inter 400/500/600) — browser synthesizes faux ${parseInt(value, 10) > 600 ? 'bold (smeared letterforms)' : 'weight'}`,
        suggestion: `Use 600 for emphasis (real font file) or add the weight to the @fontsource imports deliberately`,
      });
    }

    // --- 12. border-radius drift
    if (prop === 'border-radius' && !value.includes('var(') && !RADIUS_NEUTRAL.has(value.trim())) {
      const radSeen = new Set();
      for (const m of value.matchAll(/(\d*\.?\d+)px\b/g)) {
        const px = parseFloat(m[1]);
        if (px <= 2 || radSeen.has(px)) continue; // 1-2px micro-rounding is fine
        radSeen.add(px);
        if (RADIUS_TOKEN_BY_PX[px]) {
          add({
            category: 'radius-drift', kind: 'tokenizable', severity: 'low', file, line, selector, prop, value,
            message: `border-radius ${px}px equals a token but is hardcoded`,
            suggestion: `Use var(${RADIUS_TOKEN_BY_PX[px]})`,
          });
        } else if (px >= 99) {
          add({
            category: 'radius-drift', kind: 'tokenizable', severity: 'low', file, line, selector, prop, value,
            message: `border-radius ${px}px is a hand-rolled pill radius`,
            suggestion: `Use var(--radius-pill) (9999px)`,
          });
        } else {
          add({
            category: 'radius-drift', kind: 'off-scale', severity: 'medium', file, line, selector, prop, value,
            message: `border-radius ${px}px is outside the radius scale (4/8/16/pill) — corner-rounding drift`,
            suggestion: `Snap to --radius-sm (4px), --radius-md (8px), or --radius-lg (16px)`,
          });
        }
      }
    }

    // --- 6. type scale
    if (prop === 'font-size' && !isGlobalSheet) {
      const v = normalizeVal(value);
      if (!fontSizeVocab.has(v) && !v.includes('var(')) {
        const isPx = /px\b/.test(v);
        add({
          category: 'type-scale', severity: 'medium', file, line, selector, prop, value,
          message: `font-size ${v} is outside the documented type vocabulary${isPx ? ' (px unit — site standard is rem)' : ''}`,
          suggestion: `Map to the documented scale (see STYLE-GUIDE.md Typography) or add to the scale deliberately`,
        });
      }
    }

    // --- 7. line-height drift
    if (prop === 'line-height' && !isGlobalSheet) {
      const v = normalizeVal(value);
      if (!lineHeightVocab.has(v) && !v.includes('var(')) {
        add({
          category: 'line-height-drift', severity: 'low', file, line, selector, prop, value,
          message: `line-height ${v} not in the global vocabulary`,
          suggestion: `Standard values: headings 1.15, body 1.75, prose 1.8`,
        });
      }
    }
  });

  // --- 13. breakpoint drift (per-file, deduped per width)
  const bpSeen = new Set();
  p.root.walkAtRules('media', (at) => {
    for (const m of at.params.matchAll(/(min|max)-width\s*:\s*(\d+)px/g)) {
      const width = Number(m[2]);
      bump(hist.mediaBreakpoint, `${m[1]}-width: ${width}px`);
      if (DOCUMENTED_BREAKPOINTS.has(width) || bpSeen.has(width)) continue;
      bpSeen.add(width);
      add({
        category: 'breakpoint-drift', severity: 'low', file,
        line: (at.source?.start?.line || 0) + p.lineOffset,
        selector: `@media ${at.params}`, prop: 'media', value: `${width}px`,
        message: `Breakpoint ${width}px is not one of the documented breakpoints (640/768/769/1024) — pages reflow at different widths`,
        suggestion: `Align to the documented breakpoint set`,
      });
    }
  });

  // selector-divergence collection
  p.root.walkRules((rule) => {
    if (!rule.selector || !rule.selector.startsWith('.')) return;
    if (rule.selector.includes(':') || rule.selector.includes(' ') || rule.selector.includes(',')) return; // simple class selectors only
    const declSet = new Set();
    rule.walkDecls((d) => declSet.add(`${d.prop}:${normalizeVal(d.value)}`));
    if (!declSet.size) return;
    if (!selectorMap.has(rule.selector)) selectorMap.set(rule.selector, new Map());
    const fileMap = selectorMap.get(rule.selector);
    if (!fileMap.has(file)) fileMap.set(file, new Set());
    for (const d of declSet) fileMap.get(file).add(d);
  });
}

// --- 8. selector-divergence findings
for (const [selector, fileMap] of selectorMap) {
  if (fileMap.size < 2) continue;
  const files = [...fileMap.keys()];
  const allDecls = [...fileMap.values()];
  const union = new Set(allDecls.flatMap((s) => [...s]));
  const common = [...union].filter((d) => allDecls.every((s) => s.has(d)));
  if (common.length === union.size) continue; // identical everywhere
  // props that differ in VALUE across files (same prop, different value) — the real drift signal
  const propVals = new Map();
  for (const s of allDecls) for (const d of s) {
    const [prop] = d.split(':');
    if (!propVals.has(prop)) propVals.set(prop, new Set());
    propVals.get(prop).add(d);
  }
  const conflicting = [...propVals.entries()].filter(([, vals]) => vals.size > 1).map(([prop]) => prop);
  if (!conflicting.length) continue;
  add({
    category: 'selector-divergence', severity: 'medium',
    file: files[0], line: 0, selector, prop: conflicting.join(', '), value: '',
    message: `${selector} styled differently in ${files.length} files (${files.join(', ')}) — conflicting: ${conflicting.join(', ')}`,
    suggestion: `Consolidate into one shared definition (global.css or a component)`,
  });
}

// --- 10. inline styles
// Exempt: pure display:none (functional hiding, e.g. the Pagefind metadata pattern)
// and email templates (inline styles are mandatory in email clients).
for (const s of inlineStyles) {
  const file = rel(s.file);
  if (INLINE_STYLE_EXEMPT_FILES.has(file)) continue;
  const decls = s.value.split(';').map((x) => x.trim()).filter(Boolean);
  if (decls.every((d) => /^display\s*:\s*none$/i.test(d))) continue;
  add({
    category: 'inline-style', severity: 'low', file, line: s.line, selector: '(markup)',
    prop: 'style=', value: s.value.slice(0, 120),
    message: `Inline style attribute bypasses the design system`,
    suggestion: `Move to a class in the page <style> block using tokens`,
  });
}

// ---------------------------------------------------------------------------
// helpers used above
// ---------------------------------------------------------------------------

function normalizeVal(v) {
  return v.trim().toLowerCase()
    .replace(/\s+/g, ' ')
    // expand 3/4-digit hex shorthand (#fff -> #ffffff) so notation differences don't read as divergence
    .replace(/#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f]?)\b/g, (m, r, g, b, a) => `#${r}${r}${g}${g}${b}${b}${a ? a + a : ''}`)
    // normalize leading zeros (.8125rem -> 0.8125rem), anchored so 10.5px is untouched
    .replace(/(^|[\s(,:])\.(\d)/g, '$10.$2');
}

function nearestSpace(px) {
  let best = 4, bd = Infinity;
  for (const s of SPACE_SCALE_PX) { const d = Math.abs(s - px); if (d < bd) { bd = d; best = s; } }
  return `${best}px = var(${SPACE_TOKEN_BY_PX[best]})`;
}

function guessTokenSuggestion(name, fallback) {
  const guessMap = {
    '--surface': '--bg-surface', '--border': '--border-color', '--font-display': "'Cormorant Garamond', serif (or define a --font-display token)",
  };
  if (guessMap[name]) return `Did you mean var(${guessMap[name]})?`;
  // fuzzy: token containing the same stem
  const stem = name.replace(/^--/, '');
  const candidates = [...tokenDefs.keys()].filter((t) => t.includes(stem) || stem.includes(t.replace(/^--/, '')));
  if (candidates.length) return `Closest defined tokens: ${candidates.slice(0, 3).join(', ')}`;
  return fallback ? `Define ${name} or replace with a real token; fallback "${fallback}" is what actually renders` : `Define ${name} or remove`;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

findings.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);

const byCategory = {};
const bySeverity = {};
for (const f of findings) {
  byCategory[f.category] = (byCategory[f.category] || 0) + 1;
  bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, { score: 0, count: 0, cats: {}, worst: [] });
  const e = byFile.get(f.file);
  e.score += f.score;
  e.count++;
  e.cats[f.category] = (e.cats[f.category] || 0) + 1;
  if (e.worst.length < 3 && (f.severity === 'critical' || f.severity === 'high')) e.worst.push(f);
}
const rankedFiles = [...byFile.entries()].sort((a, b) => b[1].score - a[1].score);

const histToObj = (m) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
const summary = {
  generated: new Date().toISOString(),
  filesScanned: sourceFiles.length,
  cssChunksParsed: parsed.length,
  parseErrors,
  tokensDefined: tokenDefs.size,
  totalFindings: findings.length,
  byCategory,
  bySeverity,
  histograms: {
    fontSize: histToObj(hist.fontSize),
    lineHeight: histToObj(hist.lineHeight),
    borderRadius: histToObj(hist.borderRadius),
    fontWeight: histToObj(hist.fontWeight),
  },
};

console.log(JSON.stringify(summary, null, 2));
console.log(`\nTop 15 files by drift score:`);
for (const [file, e] of rankedFiles.slice(0, 15)) {
  console.log(`  ${String(e.score).padStart(5)}  ${String(e.count).padStart(4)} findings  ${file}`);
}

if (OUT_JSON) {
  fs.writeFileSync(OUT_JSON, JSON.stringify({ summary, findings }, null, 2));
  console.log(`\nFindings JSON -> ${OUT_JSON}`);
}

if (OUT_MD) {
  fs.writeFileSync(OUT_MD, renderMarkdown());
  console.log(`Report MD -> ${OUT_MD}`);
}

function renderMarkdown() {
  const L = [];
  L.push(`# CSS Drift & Token-Adherence Audit — rrmacademy.org`);
  L.push(``);
  L.push(`> Generated ${summary.generated} by \`scripts/css-audit/audit.mjs\`. ${summary.filesScanned} files scanned, ${summary.cssChunksParsed} CSS chunks parsed, ${summary.tokensDefined} tokens in registry. Parse errors: ${parseErrors.length}.`);
  L.push(``);
  L.push(`## Executive summary`);
  L.push(``);
  L.push(`| Severity | Count |`);
  L.push(`|---|---|`);
  for (const sev of ['critical', 'high', 'medium', 'low']) {
    L.push(`| ${sev} | ${bySeverity[sev] || 0} |`);
  }
  L.push(``);
  L.push(`| Category | Count | What it means |`);
  L.push(`|---|---|---|`);
  const catDesc = {
    'undefined-var': 'var() references a token that does not exist — silent wrong rendering / dark-mode breakage',
    'dark-unthemed': 'hardcoded light-bound color with no dark-theme path',
    'raw-color': 'color literal instead of a token (tokenizable / near-token / off-palette)',
    'raw-px-spacing': 'hardcoded px spacing (on-scale = tokenizable; off-scale = drift)',
    'type-scale': 'font-size outside the documented vocabulary',
    'line-height-drift': 'line-height outside the global vocabulary',
    'selector-divergence': 'same selector styled differently across files',
    'fallback-divergence': 'var() fallback contradicts the defined token value',
    'token-shadowing': 'page redefines a global token name',
    'inline-style': 'style= attribute bypassing the system',
    'font-weight-unsupported': 'weight with no shipped font file — browser-synthesized faux bold/light',
    'radius-drift': 'border-radius off the 4/8/16/pill scale or hardcoded',
    'breakpoint-drift': 'media query width outside the documented 640/768/769/1024 set',
  };
  for (const [cat, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    L.push(`| ${cat} | ${n} | ${catDesc[cat] || ''} |`);
  }
  L.push(``);
  L.push(`## Ranked remediation list (by impact = severity x reach)`);
  L.push(``);
  L.push(`Reach multiplier: global stylesheets & layouts x5, components x3, pages x1.`);
  L.push(``);
  L.push(`| # | File | Score | Findings | Top categories | First fix |`);
  L.push(`|---|---|---|---|---|---|`);
  rankedFiles.slice(0, 40).forEach(([file, e], i) => {
    const cats = Object.entries(e.cats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} (${n})`).join(', ');
    const first = e.worst[0] ? `${e.worst[0].message.slice(0, 90)}` : Object.keys(e.cats)[0];
    L.push(`| ${i + 1} | \`${file}\` | ${e.score} | ${e.count} | ${cats} | ${first} |`);
  });
  L.push(``);
  L.push(`## Critical: dark-mode breakage (fix first)`);
  L.push(``);
  for (const f of findings.filter((x) => x.severity === 'critical')) {
    L.push(`- \`${f.file}:${f.line}\` ${f.selector} { ${f.prop}: ${f.value} } — ${f.message}. **${f.suggestion}**`);
  }
  L.push(``);
  L.push(`## High-severity findings`);
  L.push(``);
  for (const f of findings.filter((x) => x.severity === 'high').slice(0, 80)) {
    L.push(`- \`${f.file}:${f.line}\` ${f.selector} { ${f.prop} } — ${f.message}`);
  }
  const hiCount = findings.filter((x) => x.severity === 'high').length;
  if (hiCount > 80) L.push(`- …and ${hiCount - 80} more (see findings JSON)`);
  L.push(``);
  L.push(`## Selector divergence (page-to-page variation)`);
  L.push(``);
  for (const f of findings.filter((x) => x.category === 'selector-divergence')) {
    L.push(`- **${f.selector}** — ${f.message}`);
  }
  L.push(``);
  L.push(`## Value-distribution histograms (how many "versions" of each decision exist)`);
  L.push(``);
  for (const [name, label] of [['fontSize', 'font-size'], ['lineHeight', 'line-height'], ['borderRadius', 'border-radius'], ['fontWeight', 'font-weight']]) {
    const entries = Object.entries(summary.histograms[name]);
    L.push(`### ${label} — ${entries.length} distinct values in use`);
    L.push(``);
    L.push(`| Value | Uses |`);
    L.push(`|---|---|`);
    for (const [v, n] of entries.slice(0, 25)) L.push(`| \`${v}\` | ${n} |`);
    if (entries.length > 25) L.push(`| …${entries.length - 25} more values | |`);
    L.push(``);
  }
  return L.join('\n');
}

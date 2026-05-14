#!/usr/bin/env node
/**
 * Design System SSOT generator.
 *
 * Reads src/styles/global.css, parses every CSS custom property across the
 * three theme blocks (light, dark, eink) and the theme-independent block,
 * and writes docs/design/design-system.json.
 *
 * global.css is the single source of truth. This script is deterministic:
 * run it anytime global.css changes to regenerate the JSON.
 *
 * Usage: node scripts/generate-design-tokens.mjs [--check]
 *   (no flag) Write docs/design/design-system.json
 *   --check   Exit 1 if the current file is stale (for CI)
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CSS_PATH = join(ROOT, 'src/styles/global.css');
const MANUAL_PATH = join(ROOT, 'docs/design/design-system.manual.json');
const OUTPUT_PATH = join(ROOT, 'docs/design/design-system.json');
const CHECK_MODE = process.argv.includes('--check');

// ---------- Parse ----------

const source = readFileSync(CSS_PATH, 'utf-8');

/**
 * Extract a `:root`/`[data-theme="X"]` block body by matching the selector
 * then grabbing everything up to the matching closing brace at depth 0.
 * We bail on the first closing `}` at brace depth 1 — no nested blocks inside
 * theme roots, so this is safe.
 */
function extractBlock(css, selectorRegex) {
  const match = selectorRegex.exec(css);
  if (!match) throw new Error(`Selector not found: ${selectorRegex}`);
  const start = match.index + match[0].length;
  let depth = 1;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(start, i);
    }
  }
  throw new Error(`Unclosed block: ${selectorRegex}`);
}

/**
 * Extract every `--name: value;` from a block body. Preserves the raw value
 * exactly as written (trimmed). Respects values with commas, parentheses,
 * and nested function calls.
 */
function extractTokens(body) {
  const tokens = {};
  // Match --name: <value>; where <value> may include parens/commas but not
  // an unescaped semicolon at top level.
  const re = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    const value = m[2].trim().replace(/\s+/g, ' ');
    tokens[name] = value;
  }
  return tokens;
}

const lightBody = extractBlock(source, /:root\s*,\s*\[data-theme="light"\]\s*\{/);
const darkBody = extractBlock(source, /\[data-theme="dark"\]\s*\{/);
const einkBody = extractBlock(source, /\[data-theme="eink"\]\s*\{/);

// The theme-independent block is the STANDALONE `:root {` (no comma).
// The light-theme block uses `:root, [data-theme="light"]` so it isn't matched here.
const standaloneRootRegex = /:root\s*\{/g;
const roots = [];
let rm;
while ((rm = standaloneRootRegex.exec(source)) !== null) {
  roots.push(rm.index);
}
if (roots.length !== 1) throw new Error(`Expected exactly 1 standalone :root block, found ${roots.length}`);
const sharedStart = roots[0] + source.slice(roots[0]).indexOf('{') + 1;
let depth = 1;
let sharedEnd = sharedStart;
for (let i = sharedStart; i < source.length; i++) {
  if (source[i] === '{') depth++;
  else if (source[i] === '}') {
    depth--;
    if (depth === 0) { sharedEnd = i; break; }
  }
}
const sharedBody = source.slice(sharedStart, sharedEnd);

const light = extractTokens(lightBody);
const dark = extractTokens(darkBody);
const eink = extractTokens(einkBody);
const shared = extractTokens(sharedBody);

// ---------- Classify ----------

/**
 * Group a token name into a semantic category for the JSON output.
 * Returns { group, subgroup? }
 */
function classify(name) {
  // Palettes: purple-700, neutral-100, sand-300, rose-50, sage-500
  const paletteMatch = name.match(/^(purple|neutral|sand|rose|sage)-(\d+)$/);
  if (paletteMatch) return { group: 'palette', family: paletteMatch[1], step: paletteMatch[2] };

  // Named palette neutrals
  if (name === 'cream' || name === 'white') return { group: 'palette', family: 'neutral', step: name };

  // Status palettes
  const statusMatch = name.match(/^(green|amber|yellow)-(\d+)$/);
  if (statusMatch) return { group: 'status', family: statusMatch[1], step: statusMatch[2] };

  // Tier tokens: tier1-accent, tier2-bg, tier3-border
  const tierMatch = name.match(/^tier([123])-(accent|bg|border)$/);
  if (tierMatch) return { group: 'tier', tier: `tier${tierMatch[1]}`, prop: tierMatch[2] };

  // Footer tokens
  if (name.startsWith('footer-')) return { group: 'footer', prop: name.replace(/^footer-/, '') };

  // Semantic aliases (backgrounds, text, accent, borders, error)
  const semanticAliases = new Set([
    'bg-body', 'bg-surface', 'bg-header', 'bg-card',
    'text-primary', 'text-secondary', 'text-tertiary', 'text-muted',
    'accent', 'accent-hover',
    'border-color', 'border-light',
    'color-error',
  ]);
  if (semanticAliases.has(name)) return { group: 'semantic', prop: name };

  // Effects
  if (name.startsWith('shadow-')) return { group: 'shadow', prop: name.replace(/^shadow-/, '') };
  if (name.startsWith('grain-')) return { group: 'grain', prop: name.replace(/^grain-/, '') };
  if (name.startsWith('gradient-')) return { group: 'gradient', prop: name.replace(/^gradient-/, '') };
  if (name === 'focus-ring') return { group: 'focusRing' };

  // Layout / spacing / radius
  const spaceMatch = name.match(/^space-(\d+)$/);
  if (spaceMatch) return { group: 'spacing', step: spaceMatch[1] };
  const radiusMatch = name.match(/^radius-(\w+)$/);
  if (radiusMatch) return { group: 'radius', step: radiusMatch[1] };
  const maxWidthMatch = name.match(/^max-width-(\w+)$/);
  if (maxWidthMatch) return { group: 'maxWidth', prop: maxWidthMatch[1] };
  const fontMatch = name.match(/^font-(\w+)$/);
  if (fontMatch) return { group: 'fontFamily', prop: fontMatch[1] };

  return { group: 'unclassified', name };
}

// ---------- Assemble ----------

/**
 * Build a theme object grouped semantically. Each leaf is { value, type }.
 * Type is inferred from the token group (color/dimension/shadow/etc).
 */
function typeOf(group) {
  switch (group) {
    case 'palette': return 'color';
    case 'status': return 'color';
    case 'tier': return 'color';
    case 'semantic': return 'color';
    case 'footer': return 'color';
    case 'focusRing': return 'color';
    case 'shadow': return 'shadow';
    case 'grain': return 'other';
    case 'gradient': return 'gradient';
    case 'spacing': return 'dimension';
    case 'radius': return 'dimension';
    case 'maxWidth': return 'dimension';
    case 'fontFamily': return 'fontFamily';
    default: return 'other';
  }
}

function buildTheme(tokens) {
  const out = {
    palette: { purple: {}, neutral: {}, sand: {}, rose: {}, sage: {} },
    status: { green: {}, amber: {}, yellow: {} },
    tier: { tier1: {}, tier2: {}, tier3: {} },
    semantic: {},
    footer: {},
    shadow: {},
    grain: {},
    gradient: {},
    focusRing: null,
  };
  for (const [name, value] of Object.entries(tokens)) {
    const c = classify(name);
    const type = typeOf(c.group);
    const leaf = { value, type, cssVariable: `--${name}` };
    switch (c.group) {
      case 'palette':
        out.palette[c.family][c.step] = leaf;
        break;
      case 'status':
        out.status[c.family][c.step] = leaf;
        break;
      case 'tier':
        out.tier[c.tier][c.prop] = leaf;
        break;
      case 'semantic':
        out.semantic[c.prop] = leaf;
        break;
      case 'footer':
        out.footer[c.prop] = leaf;
        break;
      case 'shadow':
        out.shadow[c.prop] = leaf;
        break;
      case 'grain':
        out.grain[c.prop] = leaf;
        break;
      case 'gradient':
        out.gradient[c.prop] = leaf;
        break;
      case 'focusRing':
        out.focusRing = leaf;
        break;
      default:
        // Theme-scoped tokens should all classify. If not, surface it.
        throw new Error(`Unclassified theme token: ${name} = ${value}`);
    }
  }
  return out;
}

function buildShared(tokens) {
  const out = { spacing: {}, radius: {}, maxWidth: {}, fontFamily: {} };
  for (const [name, value] of Object.entries(tokens)) {
    const c = classify(name);
    const type = typeOf(c.group);
    const leaf = { value, type, cssVariable: `--${name}` };
    switch (c.group) {
      case 'spacing':
        out.spacing[c.step] = leaf;
        break;
      case 'radius':
        out.radius[c.step] = leaf;
        break;
      case 'maxWidth':
        out.maxWidth[c.prop] = leaf;
        break;
      case 'fontFamily':
        out.fontFamily[c.prop] = leaf;
        break;
      default:
        throw new Error(`Unclassified shared token: ${name} = ${value}`);
    }
  }
  return out;
}

// Load hand-curated non-CSS facts (brand rules, fonts, typography scale)
const manual = JSON.parse(readFileSync(MANUAL_PATH, 'utf-8'));
// Drop any _note/_comment keys from the manual payload
function stripNotes(obj) {
  if (Array.isArray(obj)) return obj.map(stripNotes);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) {
      if (k.startsWith('_')) continue;
      out[k] = stripNotes(obj[k]);
    }
    return out;
  }
  return obj;
}
const manualClean = stripNotes(manual);

const designSystem = {
  $schema: 'https://rrmacademy.org/design-system.schema.json',
  name: 'RRM Academy Design System',
  sources: {
    tokens: 'src/styles/global.css',
    manual: 'docs/design/design-system.manual.json',
  },
  generator: 'scripts/generate-design-tokens.mjs',
  note: 'Auto-generated SSOT. Do not edit this file by hand. To change a token, edit global.css and run: node scripts/generate-design-tokens.mjs. To change a brand rule, font, or typography value, edit design-system.manual.json and regenerate.',
  brand: manualClean.brand,
  fonts: manualClean.fonts,
  typography: manualClean.typography,
  components: manualClean.components,
  themes: {
    light: buildTheme(light),
    dark: buildTheme(dark),
    eink: buildTheme(eink),
  },
  shared: buildShared(shared),
  counts: {
    light: Object.keys(light).length,
    dark: Object.keys(dark).length,
    eink: Object.keys(eink).length,
    shared: Object.keys(shared).length,
    total: Object.keys(light).length + Object.keys(dark).length + Object.keys(eink).length + Object.keys(shared).length,
  },
};

// ---------- Write / Check ----------

const newContent = JSON.stringify(designSystem, null, 2) + '\n';

if (CHECK_MODE) {
  let existing = '';
  try { existing = readFileSync(OUTPUT_PATH, 'utf-8'); } catch {}
  if (existing !== newContent) {
    console.error(`design-system.json is stale. Run: node scripts/generate-design-tokens.mjs`);
    process.exit(1);
  }
  console.log('design-system.json is up to date.');
  process.exit(0);
}

writeFileSync(OUTPUT_PATH, newContent);
console.log(`Wrote ${OUTPUT_PATH}`);
console.log(`Themes: light=${designSystem.counts.light}, dark=${designSystem.counts.dark}, eink=${designSystem.counts.eink}`);
console.log(`Shared: ${designSystem.counts.shared}`);
console.log(`Total: ${designSystem.counts.total}`);

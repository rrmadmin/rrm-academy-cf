#!/usr/bin/env node
// scripts/agent-discovery-check.mjs
// Build-time validator for the agent-readiness / MCP discovery surface.
//
// Catches the drift bugs /arise found 2026-04-29: stale workers.dev URLs,
// SKILL.md digest mismatches, OAuth flow step divergence across manifests,
// tool description drift between mcp.json and server-card.json, article
// count drift across surfaces, and ai-plugin.json self-contradiction.
//
// Pure Node, zero deps. Exits 1 on any failure.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC_DIR = join(ROOT, 'public');
const WELL_KNOWN = join(PUBLIC_DIR, '.well-known');

// ---------- helpers ----------

let failures = 0;
let checks = 0;

function ok(label) { checks++; console.log(`  \x1b[32mOK\x1b[0m   ${label}`); }
function fail(label, detail) {
  checks++; failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${label}`);
  if (detail) console.log(`       ${detail}`);
}
function section(name) { console.log(`\n\x1b[1m${name}\x1b[0m`); }

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function readText(path) {
  return readFileSync(path, 'utf8');
}
function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

// ---------- 1. JSON validity ----------

section('Phase 1: JSON manifest validity');

const JSON_MANIFESTS = [
  '.well-known/mcp.json',
  '.well-known/mcp/server-card.json',
  '.well-known/oauth-authorization-server',
  '.well-known/oauth-protected-resource',
  '.well-known/openid-configuration',
  '.well-known/agent-card.json',
  '.well-known/agent-skills/index.json',
  '.well-known/api-catalog',
  '.well-known/ai-plugin.json',
  'openapi.json',
];

for (const rel of JSON_MANIFESTS) {
  const path = join(PUBLIC_DIR, rel);
  try {
    readJson(path);
    ok(`${rel} parses as JSON`);
  } catch (err) {
    fail(`${rel} is invalid JSON`, err.message);
  }
}

// ---------- 2. SKILL.md digest integrity ----------

section('Phase 2: SKILL.md SHA256 digest integrity');

const skillsIndex = readJson(join(WELL_KNOWN, 'agent-skills/index.json'));
for (const skill of skillsIndex.skills) {
  const skillPath = join(PUBLIC_DIR, skill.url.replace(/^\//, ''));
  let actual;
  try {
    actual = `sha256:${sha256Hex(readFileSync(skillPath))}`;
  } catch (err) {
    fail(`${skill.name}: SKILL.md not found at ${skill.url}`, err.message);
    continue;
  }
  if (actual === skill.digest) {
    ok(`${skill.name}: digest matches (${actual.slice(0, 18)}...)`);
  } else {
    fail(
      `${skill.name}: digest mismatch`,
      `claimed=${skill.digest.slice(0, 25)}... actual=${actual.slice(0, 25)}...`,
    );
  }
}

// ---------- 3. No stale workers.dev URLs ----------

section('Phase 3: No stale workers.dev URLs in public surfaces');

const STALE_PATTERNS = [
  /rrm-mcp\.administrator-cloudflare\.workers\.dev/g,
];
const PUBLIC_SCAN_EXTS = ['.json', '.md', '.txt'];
const PUBLIC_SCAN_BARE = ['api-catalog', 'oauth-authorization-server', 'oauth-protected-resource', 'openid-configuration'];

for (const filePath of walk(PUBLIC_DIR)) {
  const isScan = PUBLIC_SCAN_EXTS.some(ext => filePath.endsWith(ext))
    || PUBLIC_SCAN_BARE.some(name => filePath.endsWith(name));
  if (!isScan) continue;
  const content = readText(filePath);
  for (const pattern of STALE_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) {
      fail(
        `Stale workers.dev URL in ${filePath.replace(ROOT + '/', '')}`,
        `${matches.length} occurrence(s); use mcp.rrmacademy.org instead`,
      );
    }
  }
}
if (failures === 0 || !STALE_PATTERNS.some(p => p)) {
  // Per-file FAIL printed above; print a summary OK only if no fails so far for this section
}
ok(`Scanned ${PUBLIC_SCAN_EXTS.join('/')}/bare files for stale URLs`);

// ---------- 4. Self-service auth language (no "request access: info@") ----------

section('Phase 4: MCP access language is self-service (no out-of-band info@)');

const STALE_AUTH_PATTERNS = [
  /Request access: info@rrmacademy\.org/i,
  /request via info@rrmacademy\.org/i,
  /Contact info@rrmacademy\.org to request an? API key/i,
  /contact info@rrmacademy\.org to request access/i,
];

const AUTH_SCAN_PATHS = [
  '.well-known/agent-skills/rrm-research-lookup/SKILL.md',
  '.well-known/agent-skills/rrm-editorial-guardrails/SKILL.md',
  '.well-known/agent-skills/rrm-fact-verification/SKILL.md',
  '.well-known/ai-plugin.json',
  'llms.txt',
  'llms-full.txt',
  'agents.md',
  'openapi.json',
];

for (const rel of AUTH_SCAN_PATHS) {
  const path = join(PUBLIC_DIR, rel);
  let content;
  try { content = readText(path); }
  catch { fail(`${rel} not found`); continue; }
  let bad = false;
  for (const pattern of STALE_AUTH_PATTERNS) {
    if (pattern.test(content)) {
      fail(`${rel}: stale "info@" auth instruction`, `pattern: ${pattern}`);
      bad = true;
    }
  }
  if (!bad) ok(`${rel}: self-service auth language`);
}

// ---------- 5. Article count consistency ----------

section('Phase 5: Article count consistent across discovery surfaces');

// Canonical count is whatever mcp.json claims. Other surfaces should match.
const mcpJson = readJson(join(WELL_KNOWN, 'mcp.json'));
const canonicalCountMatch = mcpJson.description.match(/(\d,\d{3}\+)\s+peer-reviewed articles/);
if (!canonicalCountMatch) {
  fail('mcp.json description has no article count match', 'expected pattern: N,NNN+ peer-reviewed articles');
} else {
  const canonical = canonicalCountMatch[1];
  ok(`Canonical count from mcp.json.description: "${canonical}"`);

  const COUNT_SCAN = [
    '.well-known/agent-card.json',
    '.well-known/mcp/server-card.json',
    '.well-known/agent-skills/index.json',
    '.well-known/agent-skills/rrm-research-lookup/SKILL.md',
    '.well-known/ai-plugin.json',
    'agents.md',
    'llms.txt',
    'llms-full.txt',
  ];

  for (const rel of COUNT_SCAN) {
    const content = readText(join(PUBLIC_DIR, rel));
    // Match any "N,NNN+" near "articles" or "research"
    const all = content.match(/(\d,\d{3}\+)\s+(?:peer-reviewed|physician-curated|indexed)/g) || [];
    const numbers = new Set(all.map(s => s.match(/(\d,\d{3}\+)/)[1]));
    if (numbers.size === 0) {
      // No mentions, skip
      continue;
    }
    if (numbers.size === 1 && numbers.has(canonical)) {
      ok(`${rel}: matches canonical (${canonical})`);
    } else {
      fail(
        `${rel}: article count drift`,
        `found ${[...numbers].join(', ')}; canonical is ${canonical}`,
      );
    }
  }
}

// ---------- 6. OAuth flow steps identical across 4 manifests ----------

section('Phase 6: OAuth flow steps identical across discovery manifests');

const oauthAS = readJson(join(WELL_KNOWN, 'oauth-authorization-server'));
const oauthPR = readJson(join(WELL_KNOWN, 'oauth-protected-resource'));
const oidc = readJson(join(WELL_KNOWN, 'openid-configuration'));
const mcpFlow = mcpJson.authentication.flow;

const flows = {
  'oauth-authorization-server.x-auth-flow': oauthAS['x-auth-flow'],
  'oauth-protected-resource.x-auth-flow': oauthPR['x-auth-flow'],
  'openid-configuration.x-auth-flow': oidc['x-auth-flow'],
  'mcp.json.authentication.flow': mcpFlow,
};

const canonical = oauthPR['x-auth-flow'];
for (const [label, flow] of Object.entries(flows)) {
  if (JSON.stringify(flow) === JSON.stringify(canonical)) {
    ok(`${label}: ${flow.length} steps, matches canonical`);
  } else {
    fail(
      `${label}: drift from canonical`,
      `length=${flow.length} canonical=${canonical.length}; first-diff at step ${flow.findIndex((s, i) => s !== canonical[i]) + 1}`,
    );
  }
}

// ---------- 7. Tool descriptions identical: mcp.json vs server-card.json ----------

section('Phase 7: Tool descriptions identical between mcp.json and server-card.json');

const serverCard = readJson(join(WELL_KNOWN, 'mcp/server-card.json'));
const mcpTools = new Map(mcpJson.tools.map(t => [t.name, t.description]));
const cardTools = new Map(serverCard.tools.map(t => [t.name, t.description]));

const allToolNames = new Set([...mcpTools.keys(), ...cardTools.keys()]);
if (mcpTools.size !== cardTools.size) {
  fail('Tool count drift', `mcp.json=${mcpTools.size} server-card.json=${cardTools.size}`);
}
for (const name of allToolNames) {
  const a = mcpTools.get(name);
  const b = cardTools.get(name);
  if (!a) { fail(`Tool "${name}" missing from mcp.json`); continue; }
  if (!b) { fail(`Tool "${name}" missing from server-card.json`); continue; }
  if (a === b) ok(`tool "${name}": descriptions match`);
  else fail(`tool "${name}": description drift`, `mcp.json="${a.slice(0, 60)}..." server-card="${b.slice(0, 60)}..."`);
}

// ---------- 8. ai-plugin.json auth shape sanity ----------

section('Phase 8: ai-plugin.json auth shape sanity');

const aiPlugin = readJson(join(WELL_KNOWN, 'ai-plugin.json'));
if (aiPlugin.auth?.type === 'none') {
  // Description claiming Bearer required while auth.type=none is a self-contradiction.
  if (/Bearer\s+API\s+key/i.test(aiPlugin.description_for_model)) {
    fail(
      'ai-plugin.json self-contradicts',
      'auth.type="none" but description_for_model says "Bearer API key" required',
    );
  } else {
    ok('ai-plugin.json: auth.type=none and description aligns');
  }
} else if (aiPlugin.auth?.type === 'user_http' && aiPlugin.auth?.authorization_type === 'bearer') {
  ok('ai-plugin.json: auth.type=user_http with bearer (canonical for ChatGPT plugin manifest)');
} else {
  fail('ai-plugin.json: unexpected auth shape', JSON.stringify(aiPlugin.auth));
}

// ---------- 9. mcp.json transports does not advertise invented protocols ----------

section('Phase 9: mcp.json transports advertise only spec-defined values');

const VALID_TRANSPORTS = new Set(['streamable-http', 'stdio']);
const declared = new Set(mcpJson.transports || []);
for (const t of declared) {
  if (!VALID_TRANSPORTS.has(t)) {
    fail(`Invalid transport "${t}" in mcp.json.transports`, `MCP spec 2025-06-18 defines: ${[...VALID_TRANSPORTS].join(', ')}`);
  }
}
if (declared.size > 0 && [...declared].every(t => VALID_TRANSPORTS.has(t))) {
  ok(`transports: [${[...declared].join(', ')}] all valid`);
}

// ---------- summary ----------

console.log();
if (failures === 0) {
  console.log(`\x1b[32m\x1b[1mALL CLEAR\x1b[0m: ${checks} checks passed.`);
  process.exit(0);
} else {
  console.log(`\x1b[31m\x1b[1mBLOCKED\x1b[0m: ${failures} of ${checks} checks failed. Fix the drift or run scripts/regen-agent-skills-digests.mjs to refresh stale digests.`);
  process.exit(1);
}

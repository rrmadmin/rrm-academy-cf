#!/usr/bin/env node
// Bulk-load authoritative source definitions from the External Sourcing Sheet
// into glossary_definition_source (rrm-auth D1).
//
// Pass 1 (this script): authority sources only — MeSH / ICD-10 / ICD-11 / SNOMED
// CT / NCI Thesaurus / MedlinePlus / Wikipedia. All visibility='public'.
//
// Pass 2 (deferred): Hilgers textbook + Boyle/IIRRM archive → visibility='internal_only'
// once Brian provides per-term allowlist.
//
// Usage:
//   node scripts/glossary/bulk-load-sources.mjs --dry-run
//   node scripts/glossary/bulk-load-sources.mjs --apply
//
// Auth: gcloud ADC (run `gcloud auth application-default login` if expired).
// D1: CF - D1 Operator - account token via 1Password. Account ID hard-coded.

import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const SHEET_ID = "1JNFrImZyp6O17NqNKsdwbvz5tF6K56yXXZ4uxzT2zvk";
const GCP_PROJECT = "rrm-academy";
const D1_ACCOUNT_ID = "ecf2c5bc8b5ebd634bcb587b3890910a";
const D1_NAME = "rrm-auth";
const SQL_OUT = "/tmp/glossary-bulk-load-sources.sql";

const args = new Set(process.argv.slice(2));
const DRY_RUN = !args.has("--apply");
const VERBOSE = args.has("--verbose");

// ---- Source slot table (sort_order) + labels + attributions ---------------

const SOURCES = {
  mesh:        { sort: 20, label: "PubMed MeSH",         attrib: "Source: NLM Medical Subject Headings (MeSH). Public domain." },
  icd10:       { sort: 30, label: "ICD-10",              attrib: "Source: WHO ICD-10 / CMS ICD-10-CM." },
  icd11:       { sort: 35, label: "ICD-11",              attrib: "Source: WHO ICD-11 MMS (2024-01)." },
  snomed:      { sort: 40, label: "SNOMED CT",           attrib: "Source: SNOMED CT (IHTSDO)." },
  nci:         { sort: 50, label: "NCI Thesaurus",       attrib: "Source: NCI Thesaurus, National Cancer Institute. Public domain." },
  medlineplus: { sort: 60, label: "MedlinePlus",         attrib: "Source: National Library of Medicine, MedlinePlus. Public domain." },
  wikipedia:   { sort: 70, label: "Wikipedia",           attrib: "Source: Wikipedia (CC BY-SA)." },
};

// ---- Sanitization ---------------------------------------------------------

const REVIEW_MARKERS = [
  /\[REVIEW/i,
  /\[FIXME/i,
  /\(best guess/i,
  /\[mp:fts\/REVIEW\]/i,
];

const STRIP_PREFIXES = [
  /^D1:\s*rec[A-Za-z0-9]+\s*\|\s*/,                 // D1 record id prefix
  /^chapter\s*--\s*[^|]+--\s*\d+\s*occurrence/i,    // textbook scanner artifact
  /^-{2,}\s*\d+\s*occurrence\(s\)\s*of\s*"[^"]+"/i, // scanner footer artifact
];

function hasReviewMarker(s) {
  return REVIEW_MARKERS.some(rx => rx.test(s));
}

function stripArtifacts(s) {
  let out = s;
  for (const rx of STRIP_PREFIXES) {
    out = out.replace(rx, "");
  }
  return out.trim();
}

// Cells in the External Sourcing Sheet are newline-delimited (one logical
// part per line). Some legacy fills used `\s+\|\s+`; tolerate both.
function splitParts(s) {
  return s.split(/\n+|\s+\|\s+/).map(p => p.trim()).filter(Boolean);
}

// Relevance gate for cascade-sourced rows (NCI / SNOMED-long / Wikipedia).
// FTS matches occasionally hit unrelated concepts (e.g. ARPR -> "Pregnancy
// Related Mood Swing", HSG -> oncology reagent). The fix: require the source
// label/text to share at least one non-stopword token with the term name.
const TOKEN_STOPWORDS = new Set([
  "the","and","for","with","from","into","onto","upon","over","under",
  "syndrome","disease","disorder","related","based","using","general",
  "pregnancy","mood","level","levels","factor","factors","status","method",
  "test","tests","study","studies","analysis","outcome","outcomes",
  "system","therapy","treatment","disease","condition","clinical","medical",
  "natural","approach","model","series","program",
]);
function tokenize(s) {
  return (s || "").toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, " ")
    .split(/[\s\-]+/)
    .filter(t => t.length >= 5 && !TOKEN_STOPWORDS.has(t));
}
function relevantToTerm(termName, ...sourceFields) {
  const termTokens = new Set(tokenize(termName));
  if (termTokens.size === 0) return true; // term name is all stopwords -> can't filter
  const sourceText = sourceFields.filter(Boolean).join(" ").toLowerCase();
  for (const t of termTokens) {
    if (sourceText.includes(t)) return true;
  }
  return false;
}

// ---- Per-column extractors -----------------------------------------------
// Each returns { definition_text, source_url, code } or null to skip.

function extractMesh(row) {
  const descriptor = (row[13] || "").trim(); // N: mesh_descriptor
  const urlCell    = (row[14] || "").trim(); // O: mesh_url (sometimes mis-populated with descriptor)
  const scope      = (row[15] || "").trim(); // P: mesh_scope_note
  if (!scope || scope.length < 20) return null;
  if (hasReviewMarker(scope)) return null;
  // Format: "(Polycystic Ovary Syndrome) A complex disorder ..."
  let text = scope.replace(/^\([^)]+\)\s*/, "").trim();
  text = stripArtifacts(text);
  if (text.length < 20) return null;
  // Construct URL from descriptor when the URL cell is missing or wrong.
  let url = null;
  if (/^https?:\/\//.test(urlCell)) url = urlCell;
  else if (descriptor) url = `https://meshb.nlm.nih.gov/record/ui?ui=${descriptor}`;
  return {
    definition_text: text,
    source_url: url,
    code: descriptor || null,
  };
}

function extractIcd10(row) {
  const code = (row[16] || "").trim(); // Q
  const url  = (row[17] || "").trim(); // R
  const def  = (row[18] || "").trim(); // S
  if (!def || def.length < 20) return null;
  if (hasReviewMarker(def)) return null;
  return { definition_text: stripArtifacts(def), source_url: url || null, code: code || null };
}

function extractIcd11(row) {
  const code = (row[19] || "").trim(); // T
  const url  = (row[20] || "").trim(); // U
  const def  = (row[21] || "").trim(); // V
  if (!def || def.length < 20) return null;
  if (hasReviewMarker(def)) return null;
  return { definition_text: stripArtifacts(def), source_url: url || null, code: code || null };
}

function extractSnomed(row, termName) {
  const shortId = (row[22] || "").trim(); // W: snomed_ct
  const long    = (row[29] || "").trim(); // AD: snomed_ct_definition
  if (long) {
    const parts = splitParts(long);
    let url = null, text = long, code = shortId || null, label = "";
    if (parts.length >= 2 && /^https?:\/\//.test(parts[0])) {
      url = parts[0];
      label = parts[1] || "";
      text = parts.slice(1).join(" — ");
      const m = url.match(/conceptId\d?=(\d+)/);
      if (m && !code) code = m[1];
    }
    text = stripArtifacts(text);
    if (text.length < 20) return null;
    if (hasReviewMarker(text)) return null;
    // FTS-cascade gate
    if (!relevantToTerm(termName, label, text)) return null;
    return { definition_text: text, source_url: url, code };
  }
  return null;
}

function extractNci(row, termName) {
  const cell = (row[27] || "").trim(); // AB: nci_thesaurus_definition
  if (!cell || cell.length < 20) return null;
  if (hasReviewMarker(cell)) return null;
  const parts = splitParts(cell);
  let url = null, text = cell, code = null, label = "";
  if (parts.length >= 2 && /^https?:\/\//.test(parts[0])) {
    url = parts[0];
    label = parts[1] || "";
    text = parts.slice(1).join(" — ");
    const m = url.match(/[?&]code=([A-Z0-9]+)/i);
    if (m) code = m[1];
  }
  text = stripArtifacts(text);
  if (text.length < 20) return null;
  if (!relevantToTerm(termName, label, text)) return null;
  return { definition_text: text, source_url: url, code };
}

function extractMedlineplus(row) {
  const url = (row[11] || "").trim(); // L
  const def = (row[12] || "").trim(); // M
  if (!def || def.length < 20) return null;
  // MedlinePlus often has `[REVIEW -- best guess from FTS, MedlinePlus title: "X"] text`
  // Skip these — they're explicitly low-confidence (per memory: "false-positive rate ~12%")
  if (hasReviewMarker(def)) return null;
  return { definition_text: stripArtifacts(def), source_url: url || null, code: null };
}

function extractWikipedia(row, termName) {
  const cell = (row[28] || "").trim(); // AC: wikipedia_summary
  if (!cell || cell.length < 20) return null;
  if (hasReviewMarker(cell)) return null;
  const parts = splitParts(cell);
  let url = null, text = cell, label = "";
  if (parts.length >= 2 && /^https?:\/\//.test(parts[0])) {
    url = parts[0];
    label = parts[1] || "";
    if (parts.length >= 3 && parts[1].length < 160) {
      text = parts.slice(2).join(" — ");
    } else {
      text = parts.slice(1).join(" — ");
    }
  }
  text = stripArtifacts(text);
  if (text.length < 20) return null;
  // Trust Wikipedia matches when the URL slug aligns with the term name
  // (e.g. /wiki/Adenomyosis); otherwise require token overlap.
  const urlSlug = (url || "").split("/").pop() || "";
  const slugMatches = relevantToTerm(termName, urlSlug.replace(/_/g, " "));
  if (!slugMatches && !relevantToTerm(termName, label, text)) return null;
  return { definition_text: text, source_url: url, code: null };
}

const EXTRACTORS = {
  mesh:        extractMesh,
  icd10:       extractIcd10,
  icd11:       extractIcd11,
  snomed:      extractSnomed,
  nci:         extractNci,
  medlineplus: extractMedlineplus,
  wikipedia:   extractWikipedia,
};

// ---- Google Sheets fetch --------------------------------------------------

function gtoken() {
  const r = spawnSync("gcloud", ["auth", "application-default", "print-access-token"],
                      { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`gcloud token failed: ${r.stderr}`);
  return r.stdout.trim();
}

async function fetchSheet(rangeA1) {
  const token = gtoken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(rangeA1)}`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "x-goog-user-project": GCP_PROJECT,
    },
  });
  if (!res.ok) {
    throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  }
  return (await res.json()).values || [];
}

// ---- SQL emission ---------------------------------------------------------

function escSql(s) {
  if (s == null) return "NULL";
  return `'${String(s).replace(/'/g, "''")}'`;
}

function buildSql(rows) {
  const lines = [];
  lines.push("-- Auto-generated by scripts/glossary/bulk-load-sources.mjs");
  lines.push(`-- Generated at: ${new Date().toISOString()}`);
  lines.push(`-- Pass: 1 (authority sources, public)`);
  lines.push(`-- Total rows: ${rows.length}`);
  lines.push("");
  for (const r of rows) {
    const meta = SOURCES[r.source_key];
    lines.push(
      `INSERT INTO glossary_definition_source ` +
      `(term_id, source_key, source_label, source_url, code, definition_text, ` +
      `is_verbatim, attribution, sort_order, status, visibility, fetched_at) ` +
      `VALUES (${escSql(r.term_id)}, ${escSql(r.source_key)}, ${escSql(meta.label)}, ` +
      `${escSql(r.source_url)}, ${escSql(r.code)}, ${escSql(r.definition_text)}, ` +
      `1, ${escSql(meta.attrib)}, ${meta.sort}, 'published', 'public', ` +
      `${escSql(new Date().toISOString())}) ` +
      `ON CONFLICT(term_id, source_key) DO UPDATE SET ` +
      `source_label = excluded.source_label, ` +
      `source_url = excluded.source_url, ` +
      `code = excluded.code, ` +
      `definition_text = excluded.definition_text, ` +
      `fetched_at = excluded.fetched_at, ` +
      `updated_at = datetime('now');`
    );
  }
  return lines.join("\n") + "\n";
}

// ---- Wrangler apply -------------------------------------------------------

function applySql(sqlPath) {
  const tokenCmd = "op read 'op://Automation/CF - D1 Operator - account/credential'";
  const token = execSync(tokenCmd, { encoding: "utf-8" }).trim();
  const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: token,
    CLOUDFLARE_ACCOUNT_ID: D1_ACCOUNT_ID,
  };
  console.log(`> wrangler d1 execute ${D1_NAME} --remote --file=${sqlPath}`);
  const r = spawnSync("npx", ["wrangler", "d1", "execute", D1_NAME, "--remote", `--file=${sqlPath}`],
                      { stdio: "inherit", env, cwd: REPO_ROOT });
  if (r.status !== 0) {
    console.error(`wrangler exited ${r.status}`);
    process.exit(r.status);
  }
}

// ---- Main -----------------------------------------------------------------

async function main() {
  console.log(`mode: ${DRY_RUN ? "DRY-RUN (no D1 writes)" : "APPLY (writes to remote D1)"}`);
  console.log(`sheet: ${SHEET_ID}`);
  console.log("");

  // Fetch Glossary tab
  console.log("Fetching Glossary tab A:AZ (rows 1-340)...");
  const all = await fetchSheet("Glossary!A1:AZ340");
  if (all.length < 2) throw new Error(`Expected header + data rows, got ${all.length}`);
  const header = all[0];
  console.log(`Header: ${header.length} cols`);
  console.log(`Total data rows: ${all.length - 1}`);

  // Filter to D1-backed terms only (id starts with "term_")
  const d1rows = all.slice(1).filter(r => r[0] && r[0].startsWith("term_"));
  console.log(`D1-backed rows: ${d1rows.length}`);
  console.log("");

  // Extract sources per row per source_key
  const planned = [];
  const skipped = { byTerm: {}, totalSkipped: 0 };
  const counts = {};
  for (const key of Object.keys(SOURCES)) counts[key] = 0;

  for (const row of d1rows) {
    const term_id = row[0];
    const termName = row[3] || "";
    const slug = row[5] || "";
    let termHits = 0;
    for (const [key, extractor] of Object.entries(EXTRACTORS)) {
      const out = extractor(row, termName);
      if (out) {
        planned.push({ term_id, slug, source_key: key, ...out });
        counts[key]++;
        termHits++;
      }
    }
    if (termHits === 0) {
      skipped.byTerm[slug] = "zero-sources";
      skipped.totalSkipped++;
    }
  }

  // Report
  console.log("--- Source coverage (Pass 1, authority) ---");
  for (const [key, cnt] of Object.entries(counts)) {
    const pct = ((cnt / d1rows.length) * 100).toFixed(0);
    console.log(`  ${key.padEnd(13)} ${String(cnt).padStart(4)} of ${d1rows.length}  (${pct}%)`);
  }
  console.log(`  ${"TOTAL".padEnd(13)} ${String(planned.length).padStart(4)} source rows planned`);
  console.log("");
  console.log(`Terms with zero sources: ${skipped.totalSkipped}`);
  if (VERBOSE && skipped.totalSkipped) {
    for (const slug of Object.keys(skipped.byTerm).sort()) {
      console.log(`  - ${slug}`);
    }
  } else if (skipped.totalSkipped) {
    const sample = Object.keys(skipped.byTerm).slice(0, 10);
    console.log(`  (sample) ${sample.join(", ")}${skipped.totalSkipped > 10 ? "..." : ""}`);
  }
  console.log("");

  // Show one full sample row per source_key in dry-run
  if (DRY_RUN) {
    console.log("--- Sample row per source_key ---");
    for (const key of Object.keys(SOURCES)) {
      const sample = planned.find(p => p.source_key === key);
      if (!sample) { console.log(`  ${key}: (no rows planned)`); continue; }
      console.log(`  ${key}:`);
      console.log(`    term_id:  ${sample.term_id}`);
      console.log(`    slug:     ${sample.slug}`);
      console.log(`    code:     ${sample.code || "(none)"}`);
      console.log(`    url:      ${sample.source_url || "(none)"}`);
      const text = sample.definition_text.replace(/\s+/g, " ").slice(0, 180);
      console.log(`    text:     ${text}${sample.definition_text.length > 180 ? "..." : ""}`);
      console.log("");
    }
  }

  // Write SQL
  const sql = buildSql(planned);
  writeFileSync(SQL_OUT, sql);
  console.log(`Wrote SQL to ${SQL_OUT} (${(sql.length / 1024).toFixed(1)} KB, ${planned.length} statements)`);

  if (DRY_RUN) {
    console.log("");
    console.log("DRY-RUN complete. Re-run with --apply to write to D1.");
    return;
  }

  console.log("");
  console.log("Applying to remote D1...");
  applySql(SQL_OUT);
  console.log("");
  console.log("Done.");
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});

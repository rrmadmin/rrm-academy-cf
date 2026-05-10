/**
 * scripts/seed-glossary-abbreviations.mjs
 *
 * Seeds the glossary_abbreviation table from a hand-curated list of the 52
 * abbreviations previously hardcoded in src/pages/glossary/index.astro.
 *
 * Each entry links to a glossary_term slug where a matching term exists,
 * or leaves term_slug null for orphan abbreviations (RMT, RIF, AAFCP, etc.)
 * that do not have a standalone defined term.
 *
 * Idempotent (ON CONFLICT DO UPDATE). Emits
 * scripts/seed-glossary-abbreviations.sql, then run:
 *   wrangler d1 execute rrm-auth --remote --file=scripts/seed-glossary-abbreviations.sql
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN_JSON = join(__dirname, '..', 'src', 'data', 'glossary.json');
const OUT_SQL = join(__dirname, 'seed-glossary-abbreviations.sql');

// Hand-curated from the pre-migration hardcoded abbreviations table.
// Order preserved. term_slug is null for abbreviations without a standalone
// glossary_term (e.g. RMT is mentioned within the isthmocele entry only).
// Format: [abbreviation, full_term, term_slug or null]
const ABBREVIATIONS = [
  ['RRM',                   'Restorative Reproductive Medicine',                                'restorative-reproductive-medicine'],
  ['NaPro',                 'NaProTECHNOLOGY (Natural Procreative Technology)',                 'naprotechnology-definition'],
  ['CrMS',                  'Creighton Model FertilityCare System',                             'creighton-model'],
  ['FABM',                  'Fertility Awareness-Based Method',                                 'fabms'],
  ['NFP',                   'Natural Family Planning',                                          'nfp'],
  ['SIS',                   'Saline Infusion Sonohysterogram',                                  'sis'],
  ['HSG',                   'Hysterosalpingogram',                                              'hsg'],
  ['SDF / DFI',             'Sperm DNA Fragmentation / DNA Fragmentation Index',                'sperm-dna-fragmentation'],
  ['ERA',                   'Endometrial Receptivity Analysis',                                 'era'],
  ['WOI',                   'Window of Implantation',                                           'window-of-implantation'],
  ['LPD',                   'Luteal Phase Deficiency',                                          'luteal-phase-deficiency'],
  ['LP',                    'Luteal Phase',                                                     'luteal-phase'],
  ['CL',                    'Corpus Luteum',                                                    'corpus-luteum'],
  ['LUF',                   'Luteinized Unruptured Follicle',                                   'luf-syndrome'],
  ['RPL',                   'Recurrent Pregnancy Loss',                                         'rpl'],
  ['APS',                   'Antiphospholipid Syndrome',                                        'aps'],
  ['POI',                   'Premature Ovarian Insufficiency',                                  'poi'],
  ['DOR',                   'Diminished Ovarian Reserve',                                       'dor'],
  ['AMH',                   'Anti-Mullerian Hormone',                                           'hormonal-abnormalities'],
  ['PCOS',                  'Polycystic Ovary Syndrome',                                        'pcos'],
  ['CE',                    'Chronic Endometritis',                                             'chronic-endometritis'],
  ['MIS',                   'Minimally Invasive Surgery',                                       'minimally-invasive-surgery'],
  ['S-MAP',                 'Systematic Mapping of the Abdomen and Pelvis',                     's-map'],
  ['LOWR',                  'Laparoscopic Ovarian Wedge Resection',                             'laparoscopic-ovarian-wedge-resection'],
  ['TLA / TT anastomosis',  'Tubal Ligation Reversal / Tubo-Tubal Anastomosis',                 'tubal-ligation-reversal'],
  ['RMT',                   'Residual Myometrial Thickness',                                    null],
  ['RIF',                   'Recurrent Implantation Failure',                                   null],
  ['OAT',                   'Oligoasthenoteratospermia',                                        'oat-syndrome'],
  ['ROS',                   'Reactive Oxygen Species',                                          'oxidative-stress'],
  ['BBT',                   'Basal Body Temperature',                                           'bbt'],
  ['LH',                    'Luteinizing Hormone',                                               'hormonal-abnormalities'],
  ['FSH',                   'Follicle-Stimulating Hormone',                                      'hormonal-abnormalities'],
  ['hCG',                   'Human Chorionic Gonadotropin',                                      'hormonal-abnormalities'],
  ['FEMM',                  'Fertility Education and Medical Management',                       'femm'],
  ['RHRI',                  'Reproductive Health Research Institute',                           'reproductive-health-research-institute'],
  ['LDN',                   'Low-Dose Naltrexone',                                              'ldn'],
  ['DHEA',                  'Dehydroepiandrosterone',                                           'dhea-supplementation'],
  ['NK cells',              'Natural Killer cells',                                              'immune-modifying-framework'],
  ['MIGS',                  'Minimally Invasive Gynecologic Surgery',                           'migs'],
  ['FCP',                   'FertilityCare Practitioner',                                       'fertilitycare-practice'],
  ['AAFCP',                 'American Academy of FertilityCare Professionals',                  null],
  ['IUI',                   'Intrauterine Insemination',                                        'iui'],
  ['IVF',                   'In Vitro Fertilization',                                           'ivf'],
  ['ICSI',                  'Intracytoplasmic Sperm Injection',                                  'ivf'],
  ['PGT-A',                 'Preimplantation Genetic Testing for Aneuploidy',                   'pgt-a'],
  ['EMMA',                  'Endometrial Microbiome Metagenomic Analysis',                      'emma-alice'],
  ['ALICE',                 'Analysis of Infectious Chronic Endometritis',                      'emma-alice'],
  ['MTHFR',                 'Methylenetetrahydrofolate Reductase',                              'methylated-folate'],
  ['5-MTHF',                '5-Methyltetrahydrofolate (L-Methylfolate)',                        'methylated-folate'],
  ['TTP',                   'Time to Pregnancy',                                                'time-to-pregnancy'],
  ['OHSS',                  'Ovarian Hyperstimulation Syndrome',                                 'ivf'],
  ['AFC',                   'Antral Follicle Count',                                             'hormonal-abnormalities'],
];

function sqlEscape(str) {
  if (str == null) return 'NULL';
  return `'${String(str).replace(/'/g, "''")}'`;
}

function main() {
  // Validate term_slug references against actual glossary_term slugs.
  const data = JSON.parse(readFileSync(IN_JSON, 'utf-8'));
  const validSlugs = new Set(data.terms.map(t => t.slug));
  const missing = ABBREVIATIONS
    .filter(([_, __, slug]) => slug && !validSlugs.has(slug))
    .map(([abbr, , slug]) => `${abbr} -> ${slug}`);
  if (missing.length) {
    throw new Error(`Abbreviation term_slug references do not exist in glossary.json:\n  ${missing.join('\n  ')}`);
  }

  // Check abbreviation uniqueness
  const abbrs = new Set();
  for (const [abbr] of ABBREVIATIONS) {
    if (abbrs.has(abbr)) throw new Error(`Duplicate abbreviation: ${abbr}`);
    abbrs.add(abbr);
  }

  const lines = [];
  lines.push('-- scripts/seed-glossary-abbreviations.sql');
  lines.push('-- Auto-generated by seed-glossary-abbreviations.mjs');
  lines.push(`-- ${ABBREVIATIONS.length} rows`);
  lines.push('-- Idempotent upsert: safe to re-run. Preserves admin edits to sort_order.');
  lines.push('-- Run: wrangler d1 execute rrm-auth --remote --file=scripts/seed-glossary-abbreviations.sql');
  lines.push('');
  for (let i = 0; i < ABBREVIATIONS.length; i++) {
    const [abbr, full, slug] = ABBREVIATIONS[i];
    lines.push(
      `INSERT INTO glossary_abbreviation (abbreviation, full_term, term_slug, sort_order) VALUES (${sqlEscape(abbr)}, ${sqlEscape(full)}, ${sqlEscape(slug)}, ${i}) ON CONFLICT(abbreviation) DO UPDATE SET full_term=excluded.full_term, term_slug=excluded.term_slug, updated_at=datetime('now');`
    );
  }

  writeFileSync(OUT_SQL, lines.join('\n') + '\n');
  console.log(`Wrote ${OUT_SQL} (${ABBREVIATIONS.length} rows)`);
  console.log(`  ${ABBREVIATIONS.length - missing.length} linked to a term`);
  console.log(`  ${ABBREVIATIONS.filter(a => !a[2]).length} orphan abbreviations (no standalone term)`);

  // Merge abbreviations into glossary.json so local builds match the live
  // /api/glossary/terms response shape (which includes abbreviations).
  data.abbreviations = ABBREVIATIONS.map(([abbr, full, slug], i) => ({
    abbreviation: abbr,
    fullTerm: full,
    termSlug: slug,
    sortOrder: i,
  }));
  data.generatedAt = new Date().toISOString();
  writeFileSync(IN_JSON, JSON.stringify(data, null, 2));
  console.log(`Merged ${data.abbreviations.length} abbreviations into ${IN_JSON}`);
}

main();

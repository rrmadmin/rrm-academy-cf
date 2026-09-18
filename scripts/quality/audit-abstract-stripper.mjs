#!/usr/bin/env node
/**
 * Standing over-strip audit for src/lib/abstract-snippet.mjs.
 *
 * WHY THIS EXISTS, AND WHY IT IS SHAPED LIKE THIS.
 *
 * From 2026-07-13 to 2026-09-18 the stripper deleted real prose from 860 of
 * 3,720 abstracts, 29,935 characters, and the file's own header said
 * "Corpus-audited over 3,720 abstracts: 1,233 distinct labels removed, 0 left
 * leading, 0 false positives."
 *
 * That audit was real. It measured the wrong thing. It counted what the
 * stripper removed ON PURPOSE (labels removed, none left leading) and never
 * asked what else had gone. Both of its counts were true, and both stayed true
 * for 67 days while the defect shipped. The damage was mid-sentence and
 * grammatical -- a sentence lost its last few words, never a visible
 * truncation -- so no label-shaped question could see it.
 *
 * So this audit asks the opposite question. It does not count labels. It takes
 * every span the stripper REMOVES and asks whether that span looks like a
 * section label at all, and it reports the ones that do not. That is the
 * question a label count cannot answer, and it is the only kind of audit that
 * could have caught the `i` flag.
 *
 * It replaces no gate. validate-abstract-snippets.mjs guards the leaked-label
 * direction and cannot see over-stripping at all (its detector IS the
 * stripper's regex, so it asks whether a fixed point is a fixed point). This is
 * the other half, and it is a REPORT, run by hand or in a review, not a
 * blocking gate: the judgement of whether a removal is legitimate needs a
 * reader.
 *
 * Usage:
 *   node scripts/quality/audit-abstract-stripper.mjs
 *   node scripts/quality/audit-abstract-stripper.mjs --data <file> --json
 *   node scripts/quality/audit-abstract-stripper.mjs --limit 40
 *
 * Exit codes:
 *   0  ran (findings are printed; this is a report, not a gate)
 *   2  could not run: no data file. Distinct from 0 on purpose, because
 *      "I could not look" must never read like "I looked and it was clean".
 *      A pre-commit hook in this repo printed a specific content diagnosis for
 *      exit 2 on 2026-09-18 and sent an investigation at the wrong thing.
 */
import fs from 'node:fs';
import { abstractSnippet, ABSTRACT_LABEL_WORDS } from '../../src/lib/abstract-snippet.mjs';

const DEFAULT_DATA = 'src/data/articles.json';

/** A vocabulary label, on its own, anchored. */
const VOCAB_ONLY = new RegExp(`^(?:${ABSTRACT_LABEL_WORDS})$`, 'iu');
/** An ALL-CAPS run of the shape the generic arm is meant to match. */
const CAPS_ONLY = /^[A-Z][A-Z][A-Z \/&-]{0,28}$/u;

/**
 * Every span the stripper removed, as {text, index, before}.
 *
 * Derived by walking the original and the snippet together rather than by
 * re-running the regex, so it measures what ACTUALLY disappeared. Running the
 * regex again would inherit any bug the regex has, which is exactly how the
 * first audit ended up agreeing with the code it was auditing.
 */
export function removedSpans(original, snippet) {
  // WORD level, not character level, and this took three attempts to get right.
  // The failures are worth recording because each one INVENTED FINDINGS, which
  // is the exact failure mode this audit exists to catch:
  //
  //   1. Character walk, re-sync on the first matching character. After
  //      deleting "IMPORTANCE: " the next snippet character is "I", which
  //      matched the "I" inside the deleted word. Reported 2,559 spans shaped
  //      like "MPORTANCE: I".
  //   2. Character walk, re-sync AND advance on a 12-character anchor. The
  //      anchor window straddles an upcoming divergence, so it declared a
  //      removal twelve characters early, every time.
  //   3. Character walk, advance on plain equality, re-sync on the anchor.
  //      Still wrong: in "... cells. CONCLUSIONS: Ci67 ..." the "C" of
  //      CONCLUSIONS matched the "C" of the following word, so the span came
  //      out as "ONCLUSIONS: C". 524 of those.
  //
  // Words fix it structurally: "CONCLUSIONS:" is one token and cannot
  // partially match "Ci67". A two-word anchor then makes a false re-sync
  // vanishingly unlikely without straddling anything.
  const norm = (s) => String(s).replace(/\s+/gu, ' ').trim();
  const a = norm(original);
  const aw = a.length ? a.split(' ') : [];
  const bw = norm(snippet).length ? norm(snippet).split(' ') : [];

  // Character offset of each word in `a`, so spans can report a real index.
  const offs = [];
  let at = 0;
  for (const w of aw) { offs.push(at); at += w.length + 1; }

  const anchored = (i, j) => aw[i] === bw[j]
    && (j + 1 >= bw.length || i + 1 >= aw.length || aw[i + 1] === bw[j + 1]);

  const spans = [];
  let i = 0, j = 0;
  const pushSpan = (from, to) => {
    if (to <= from) return;
    const start = offs[from];
    const text = aw.slice(from, to).join(' ');
    spans.push({ text, index: start, before: a.slice(Math.max(0, start - 60), start) });
  };
  while (j < bw.length && i < aw.length) {
    // Advance on plain WORD equality. The two-word anchor is a re-sync tool
    // only: using it to advance made the walk bail one word early at every
    // divergence, because the anchor window straddles it. Plain equality is
    // safe at word level in a way it was not at character level, since a word
    // cannot partially match another word.
    if (aw[i] === bw[j]) { i += 1; j += 1; continue; }
    const from = i;
    let k = i + 1;
    while (k < aw.length && !anchored(k, j)) k += 1;
    pushSpan(from, k);
    i = k;
    if (k >= aw.length) break;
  }
  if (i < aw.length) pushSpan(i, aw.length);
  return spans.filter((s) => s.text.length > 0);
}

/** Classify one removed span. */
export function classify(span) {
  const bare = span.text.replace(/[:\s]+$/u, '').trim();
  const atStart = span.index === 0;
  // A section boundary: start of the abstract, or after sentence punctuation.
  const tail = span.before.replace(/\s+$/u, '');
  const atBoundary = atStart || /[.!?;]$/u.test(tail) || tail === '';
  let kind;
  if (VOCAB_ONLY.test(bare)) kind = 'vocabulary';
  else if (CAPS_ONLY.test(bare)) kind = 'caps-run';
  else kind = 'NEITHER';
  return { ...span, bare, kind, atBoundary };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const m = argv[i].match(/^--([\w-]+)(?:=(.*))?$/u);
    if (!m) continue;
    if (m[2] !== undefined) out[m[1]] = m[2];
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[m[1]] = argv[i += 1];
    else out[m[1]] = true;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const dataPath = args.data || args.file || DEFAULT_DATA;
  if (!fs.existsSync(dataPath)) {
    console.error(`audit-abstract-stripper: COULD NOT RUN. Data file not found: ${dataPath}`);
    console.error('  src/data/articles.json is generated and gitignored. Populate it (npm run');
    console.error('  fetch-data) or pass --data. Exit 2 means nothing was measured.');
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const articles = Array.isArray(raw) ? raw : raw.articles || Object.values(raw);

  const tally = { abstracts: 0, removals: 0, vocabulary: 0, 'caps-run': 0, NEITHER: 0, midSentence: 0 };
  const suspects = [];
  const capsMid = [];
  for (const a of articles) {
    if (!a || !a.abstract) continue;
    tally.abstracts += 1;
    const snippet = abstractSnippet(a.abstract);
    for (const span of removedSpans(a.abstract, snippet)) {
      const c = classify(span);
      tally.removals += 1;
      tally[c.kind] += 1;
      if (!c.atBoundary) tally.midSentence += 1;
      if (c.kind === 'NEITHER') suspects.push({ slug: a.slug || a.id, ...c });
      else if (c.kind === 'caps-run' && !c.atBoundary) capsMid.push({ slug: a.slug || a.id, ...c });
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ tally, suspects: suspects.slice(0, 200), capsMid: capsMid.slice(0, 200) }, null, 2));
    process.exit(0);
  }

  const limit = Number(args.limit || 25);
  console.log('Abstract stripper over-strip audit');
  console.log(`  abstracts scanned        ${tally.abstracts}`);
  console.log(`  spans removed            ${tally.removals}`);
  console.log(`    a vocabulary label     ${tally.vocabulary}`);
  console.log(`    an ALL-CAPS run        ${tally['caps-run']}`);
  console.log(`    NEITHER                ${tally.NEITHER}   <-- over-strip suspects`);
  console.log(`  removed mid-sentence     ${tally.midSentence}`);
  console.log('');
  if (suspects.length === 0) {
    console.log('  No removal failed to look like a label. That is the clean result, and it is');
    console.log('  the claim the old header made without measuring it.');
  } else {
    console.log(`  ${suspects.length} removal(s) matched neither arm. Each is text the stripper deleted`);
    console.log('  that is not a label by its own definition:');
    for (const s of suspects.slice(0, limit)) {
      console.log(`    ${s.slug}`);
      console.log(`      removed: ${JSON.stringify(s.text.slice(0, 70))}`);
      console.log(`      after:   ${JSON.stringify(s.before.slice(-45))}`);
    }
    if (suspects.length > limit) console.log(`    ... and ${suspects.length - limit} more (--limit to show)`);
  }
  if (capsMid.length) {
    console.log('');
    console.log(`  ${capsMid.length} ALL-CAPS removal(s) sit MID-SENTENCE rather than at a section`);
    console.log('  boundary. Most are fragments of split multi-part labels ("DURATION" out of');
    console.log('  "STUDY DESIGN, SIZE, DURATION:"); a few are real acronyms used before a');
    console.log('  colon, which the generic arm cannot tell apart. Reviewed 2026-09-18: 129');
    console.log('  fragments, 2 real acronyms (both AMH). Left alone deliberately.');
    const top = {};
    for (const c of capsMid) top[c.bare] = (top[c.bare] || 0) + 1;
    for (const [k, v] of Object.entries(top).sort((x, y) => y[1] - x[1]).slice(0, 12)) {
      console.log(`    ${String(v).padStart(4)}  ${JSON.stringify(k)}`);
    }
  }
  console.log('');
  console.log('  This is a REPORT, not a gate: exit 0 means it ran, never that it approved.');
  process.exit(0);
}

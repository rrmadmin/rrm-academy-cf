/**
 * Enrich glossary.json with cross-glossary auto-links + per-term backlinks
 * from other reference content (library articles, FAQs, courses) and a
 * "Related terms" rail.
 *
 * Inputs (read from src/data/):
 *   glossary.json   -- glossary terms (this is mutated in place)
 *   articles.json   -- library articles
 *   faqs.json       -- FAQ entries
 *   courses.json    -- courses
 *
 * Output: src/data/glossary.json with each term carrying:
 *   bodyHtml            -- now with <a href="#<other-term>"> cross-links injected
 *                          (intra-page on the pillar; the spoke component
 *                          rewrites #<slug> -> /glossary/<slug>/)
 *   relatedTerms        -- array of { slug, name, part } (max 6)
 *   relatedContent      -- { library: [...], faqs: [...], courses: [...] }
 *
 * Citation policy (2026-05-03): glossary may NOT cite commentary. Posts
 * are intentionally not scanned. See feedback-rrma-link-direction-policy.md.
 *
 * Run:
 *   node src/lib/enrich-glossary.mjs
 *
 * Idempotent: rerunning produces the same output. Safe in single-record
 * dispatch builds because the script reads whatever is in glossary.json
 * after fetch-glossary-data.mjs ran.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const GLOSSARY_PATH = join(DATA_DIR, 'glossary.json');
const ARTICLES_PATH = join(DATA_DIR, 'articles.json');
const FAQS_PATH = join(DATA_DIR, 'faqs.json');
const COURSES_PATH = join(DATA_DIR, 'courses.json');

const MAX_BACKLINKS_PER_TYPE = 5;
const MAX_RELATED_TERMS = 6;
const MAX_AUTOLINKS_PER_BODY = 12;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeAtomic(path, data) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

/**
 * Build alias list for a glossary term. Each alias is independently matched.
 *  - bare name: name with any "(...)" suffixes stripped, e.g.
 *    "Restorative Reproductive Medicine (RRM)" -> "Restorative Reproductive Medicine"
 *  - parenthetical tokens: each "(...)" group becomes its own alias
 *  - abbreviation field if set
 *
 * Aliases <= 3 chars are matched case-sensitively (otherwise "RRM" would
 * gobble unrelated three-letter substrings); longer aliases match
 * case-insensitively at word boundaries.
 */
/**
 * Accept a parenthetical token as an alias only when it carries enough
 * specificity to disambiguate. Rejects single-word common-English tokens
 * (e.g. "Laparoscopic") that would otherwise clobber unrelated bodies.
 */
function isUsefulParenAlias(token) {
  const t = token.trim();
  if (!t || t.length < 2) return false;
  // All-caps abbreviation (RRM, LPD, FCP, etc.) -- 2-8 chars with at least one letter.
  if (/^[A-Z][A-Z0-9./-]{1,7}$/.test(t)) return true;
  // Multi-word phrase (likely a definitional expansion: "Natural Procreative Technology").
  if (t.split(/\s+/).length >= 2) return true;
  // Single-word tokens are too generic to be safe aliases.
  return false;
}

function buildAliases(term) {
  const aliases = new Set();
  const bare = term.name.replace(/\s*\([^)]+\)\s*/g, ' ').trim();
  if (bare) aliases.add(bare);
  const parenMatches = term.name.match(/\(([^)]+)\)/g);
  if (parenMatches) {
    for (const m of parenMatches) {
      const inner = m.slice(1, -1).trim();
      if (isUsefulParenAlias(inner)) aliases.add(inner);
    }
  }
  if (term.abbreviation && term.abbreviation.trim()) {
    aliases.add(term.abbreviation.trim());
  }
  return [...aliases]
    .filter(a => a.length >= 2)
    .map(a => ({
      text: a,
      caseSensitive: a.length <= 3 || /^[A-Z][A-Z0-9./-]*$/.test(a),
    }));
}

/**
 * Build a single combined regex over all (alias, slug) pairs, sorted by
 * length descending so "luteal phase deficiency" wins over "phase".
 *
 * Returns { regex, lookup }: regex finds any alias as a whole word; lookup
 * maps the matched text (lowercased for case-insensitive aliases) back to
 * the term slug.
 */
function buildAliasIndex(terms) {
  const all = [];
  for (const t of terms) {
    for (const alias of buildAliases(t)) {
      all.push({ slug: t.slug, alias });
    }
  }
  all.sort((a, b) => b.alias.text.length - a.alias.text.length);

  const ciPatterns = [];
  const csPatterns = [];
  const lookup = new Map();
  for (const { slug, alias } of all) {
    const escaped = escapeRegex(alias.text);
    if (alias.caseSensitive) {
      csPatterns.push(escaped);
      lookup.set(`cs:${alias.text}`, slug);
    } else {
      ciPatterns.push(escaped);
      lookup.set(`ci:${alias.text.toLowerCase()}`, slug);
    }
  }
  // \b is unicode-aware enough for English-only content here.
  // Use lookbehind/lookahead to avoid linking inside larger words.
  const ciRegex = ciPatterns.length
    ? new RegExp(`\\b(?:${ciPatterns.join('|')})\\b`, 'gi')
    : null;
  const csRegex = csPatterns.length
    ? new RegExp(`\\b(?:${csPatterns.join('|')})\\b`, 'g')
    : null;
  return { ciRegex, csRegex, lookup };
}

function lookupSlug(lookup, matchText, isCaseSensitive) {
  if (isCaseSensitive) {
    return lookup.get(`cs:${matchText}`) ?? null;
  }
  return lookup.get(`ci:${matchText.toLowerCase()}`) ?? null;
}

/**
 * Tokenize HTML into a flat sequence of {kind, text} where kind is "tag" or
 * "text". Walks linearly; sufficient for the well-formed sanitized HTML
 * stored in glossary_term.body_html.
 */
function tokenizeHtml(html) {
  const tokens = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) {
        tokens.push({ kind: 'text', text: html.slice(i) });
        break;
      }
      tokens.push({ kind: 'tag', text: html.slice(i, end + 1) });
      i = end + 1;
    } else {
      const next = html.indexOf('<', i);
      if (next === -1) {
        tokens.push({ kind: 'text', text: html.slice(i) });
        break;
      }
      tokens.push({ kind: 'text', text: html.slice(i, next) });
      i = next;
    }
  }
  return tokens;
}

const SKIP_TAGS = new Set(['a', 'code', 'pre', 'sup', 'script', 'style', 'h1', 'h2', 'h3', 'h4']);

function isOpeningTag(tagText) {
  return /^<[a-zA-Z]/.test(tagText);
}
function isClosingTag(tagText) {
  return /^<\/[a-zA-Z]/.test(tagText);
}
function isSelfClosing(tagText) {
  return /\/>\s*$/.test(tagText) ||
    /^<(?:br|hr|img|input|meta|link|source|track|wbr)\b/i.test(tagText);
}
function tagName(tagText) {
  const m = tagText.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Walk tokens; in any text node not under a SKIP_TAGS ancestor, replace at
 * most one match per (target slug) with an internal anchor. Caps total
 * insertions per body at MAX_AUTOLINKS_PER_BODY to avoid over-linking.
 */
function autoLinkBody(html, term, aliasIndex) {
  const { ciRegex, csRegex, lookup } = aliasIndex;
  if (!ciRegex && !csRegex) return html;

  const tokens = tokenizeHtml(html);
  const skipStack = [];
  const usedSlugs = new Set([term.slug]);
  let inserted = 0;

  function matchInText(text) {
    if (inserted >= MAX_AUTOLINKS_PER_BODY) return text;

    // Collect candidate matches from both regex passes; pick longest-first
    // by match length to honor sort order, then resolve to slug.
    const candidates = [];
    if (ciRegex) {
      ciRegex.lastIndex = 0;
      let m;
      while ((m = ciRegex.exec(text)) !== null) {
        candidates.push({ index: m.index, length: m[0].length, text: m[0], cs: false });
      }
    }
    if (csRegex) {
      csRegex.lastIndex = 0;
      let m;
      while ((m = csRegex.exec(text)) !== null) {
        candidates.push({ index: m.index, length: m[0].length, text: m[0], cs: true });
      }
    }
    if (candidates.length === 0) return text;

    // Resolve each to a slug and drop self / already-used / unresolved.
    const resolved = [];
    for (const c of candidates) {
      const slug = lookupSlug(lookup, c.text, c.cs);
      if (!slug) continue;
      if (usedSlugs.has(slug)) continue;
      resolved.push({ ...c, slug });
    }
    if (resolved.length === 0) return text;

    // Pick non-overlapping matches greedily, longest-first; if equal, leftmost.
    resolved.sort((a, b) => (b.length - a.length) || (a.index - b.index));
    const chosen = [];
    const occupied = []; // sorted intervals [start, endExclusive]
    function overlaps(start, end) {
      for (const [s, e] of occupied) {
        if (start < e && end > s) return true;
      }
      return false;
    }
    for (const c of resolved) {
      if (inserted + chosen.length >= MAX_AUTOLINKS_PER_BODY) break;
      if (usedSlugs.has(c.slug)) continue;
      const end = c.index + c.length;
      if (overlaps(c.index, end)) continue;
      chosen.push(c);
      occupied.push([c.index, end]);
      usedSlugs.add(c.slug);
    }
    if (chosen.length === 0) return text;

    // Apply replacements left-to-right.
    chosen.sort((a, b) => a.index - b.index);
    let out = '';
    let cursor = 0;
    for (const c of chosen) {
      out += text.slice(cursor, c.index);
      out += `<a href="#${c.slug}" class="gloss-xref">${text.slice(c.index, c.index + c.length)}</a>`;
      cursor = c.index + c.length;
    }
    out += text.slice(cursor);
    inserted += chosen.length;
    return out;
  }

  let result = '';
  for (const tok of tokens) {
    if (tok.kind === 'tag') {
      const name = tagName(tok.text);
      if (SKIP_TAGS.has(name)) {
        if (isOpeningTag(tok.text) && !isSelfClosing(tok.text)) {
          skipStack.push(name);
        } else if (isClosingTag(tok.text)) {
          // Pop matching ancestor.
          for (let i = skipStack.length - 1; i >= 0; i--) {
            if (skipStack[i] === name) {
              skipStack.splice(i, 1);
              break;
            }
          }
        }
      }
      result += tok.text;
    } else {
      if (skipStack.length > 0) {
        result += tok.text;
      } else {
        result += matchInText(tok.text);
      }
    }
  }
  return result;
}

/**
 * Build a backlink index: which content items mention each term?
 *
 * For each content item, run the combined alias regex over its searchable
 * text (title + body). Score = title-mentions * 3 + body-mentions * 1.
 *
 * Returns Map<termSlug, [{type, slug, title, score}, ...]> already sorted
 * top-N per type.
 */
function buildBacklinkIndex(terms, aliasIndex) {
  const { ciRegex, csRegex, lookup } = aliasIndex;
  const index = new Map();
  for (const t of terms) index.set(t.slug, []);

  function findMentions(text) {
    if (!text) return new Map();
    const counts = new Map();
    if (ciRegex) {
      ciRegex.lastIndex = 0;
      let m;
      while ((m = ciRegex.exec(text)) !== null) {
        const slug = lookupSlug(lookup, m[0], false);
        if (slug) counts.set(slug, (counts.get(slug) || 0) + 1);
      }
    }
    if (csRegex) {
      csRegex.lastIndex = 0;
      let m;
      while ((m = csRegex.exec(text)) !== null) {
        const slug = lookupSlug(lookup, m[0], true);
        if (slug) counts.set(slug, (counts.get(slug) || 0) + 1);
      }
    }
    return counts;
  }

  function record(item) {
    const titleMentions = findMentions(item.titleText);
    const bodyMentions = findMentions(item.bodyText);
    const allSlugs = new Set([...titleMentions.keys(), ...bodyMentions.keys()]);
    for (const slug of allSlugs) {
      if (!index.has(slug)) continue;
      const score = (titleMentions.get(slug) || 0) * 3 + (bodyMentions.get(slug) || 0);
      if (score === 0) continue;
      index.get(slug).push({
        type: item.type,
        slug: item.slug,
        title: item.title,
        score,
      });
    }
  }

  return { index, record };
}

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function arrJoin(v) {
  if (Array.isArray(v)) return v.join(' ');
  if (typeof v === 'string') return v;
  return '';
}

function ingestArticles(articles, recorder) {
  for (const a of articles) {
    if (!a.slug) continue;
    recorder.record({
      type: 'library',
      slug: a.slug,
      title: a.title || a.slug,
      titleText: [a.title, arrJoin(a.keywords), arrJoin(a.topics), arrJoin(a.searchTerms)]
        .filter(Boolean).join(' '),
      bodyText: a.abstract || '',
    });
  }
}

function ingestFaqs(faqs, recorder) {
  for (const f of faqs) {
    if (!f.slug) continue;
    recorder.record({
      type: 'faqs',
      slug: f.slug,
      title: f.question || f.slug,
      titleText: f.question || '',
      bodyText: stripHtml(f.publishedAnswer) + ' ' + stripHtml(f.basicAnswer) + ' ' + stripHtml(f.schemaAnswer),
    });
  }
}

function ingestCourses(courses, recorder) {
  for (const c of courses) {
    if (!c.slug) continue;
    if (c.comingSoon) continue;
    recorder.record({
      type: 'courses',
      slug: c.slug,
      title: c.title || c.slug,
      titleText: c.title || '',
      bodyText: stripHtml(c.description) + ' ' + (c.shortDescription || ''),
    });
  }
}

/**
 * Compute relatedTerms per term. Two sources, in order:
 *   1. Mention graph: terms whose body contains a mention of THIS term, OR
 *      vice versa. Sort by mention count.
 *   2. Same-Part neighbors as fallback to fill up to MAX_RELATED_TERMS.
 *
 * Returns a flat array sorted by (mentionScore desc, name asc).
 */
function computeRelatedTerms(terms, aliasIndex) {
  const { ciRegex, csRegex, lookup } = aliasIndex;
  const bySlug = new Map(terms.map(t => [t.slug, t]));
  const mentions = new Map(terms.map(t => [t.slug, new Map()])); // slug -> Map<otherSlug, count>

  for (const t of terms) {
    const text = stripHtml(t.bodyHtml);
    const counts = new Map();
    if (ciRegex) {
      ciRegex.lastIndex = 0;
      let m;
      while ((m = ciRegex.exec(text)) !== null) {
        const slug = lookupSlug(lookup, m[0], false);
        if (slug && slug !== t.slug) counts.set(slug, (counts.get(slug) || 0) + 1);
      }
    }
    if (csRegex) {
      csRegex.lastIndex = 0;
      let m;
      while ((m = csRegex.exec(text)) !== null) {
        const slug = lookupSlug(lookup, m[0], true);
        if (slug && slug !== t.slug) counts.set(slug, (counts.get(slug) || 0) + 1);
      }
    }
    mentions.set(t.slug, counts);
  }

  const result = new Map();
  for (const t of terms) {
    const score = new Map();
    // Outbound (this term mentions others)
    for (const [other, n] of mentions.get(t.slug)) {
      score.set(other, (score.get(other) || 0) + n);
    }
    // Inbound (others mention this term)
    for (const [other, otherCounts] of mentions) {
      const n = otherCounts.get(t.slug) || 0;
      if (n > 0) score.set(other, (score.get(other) || 0) + n);
    }
    score.delete(t.slug);

    let related = [...score.entries()]
      .map(([slug, s]) => ({ slug, score: s, term: bySlug.get(slug) }))
      .filter(r => r.term)
      .sort((a, b) => (b.score - a.score) || a.term.name.localeCompare(b.term.name))
      .slice(0, MAX_RELATED_TERMS)
      .map(r => ({ slug: r.slug, name: r.term.name, part: r.term.part }));

    if (related.length < MAX_RELATED_TERMS) {
      const have = new Set(related.map(r => r.slug));
      const sameParts = terms
        .filter(o => o.slug !== t.slug && o.part === t.part && !have.has(o.slug))
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .slice(0, MAX_RELATED_TERMS - related.length)
        .map(o => ({ slug: o.slug, name: o.name, part: o.part }));
      related = related.concat(sameParts);
    }
    result.set(t.slug, related);
  }
  return result;
}

async function main() {
  const glossary = readJson(GLOSSARY_PATH, null);
  if (!glossary || !Array.isArray(glossary.terms)) {
    console.error('enrich-glossary: glossary.json not found or malformed; skipping.');
    return;
  }
  const articles = readJson(ARTICLES_PATH, []);
  const faqs = readJson(FAQS_PATH, []);
  const courses = readJson(COURSES_PATH, []);

  const terms = glossary.terms;
  console.log(`enrich-glossary: ${terms.length} terms; ${articles.length} articles, ${faqs.length} faqs, ${courses.length} courses`);

  const aliasIndex = buildAliasIndex(terms);
  const totalAliases = aliasIndex.lookup.size;
  console.log(`enrich-glossary: built alias index with ${totalAliases} aliases`);

  // 0. Extract editorial "See also" picks from bodyHtml and strip the
  //    inline "See also: ..." sentence/paragraph. The slugs become
  //    term.editorialRelated, which prepends the relatedTerms rail in
  //    step 3 so curator picks render as the first chips. This collapses
  //    the prior duplicate "See also" sentence + Related-terms rail into
  //    a single visual surface (plan: clever-strolling-candle.md).
  //
  //    Two patterns covered:
  //      A. <p>See also: <a>...</a>.</p>  -- own paragraph; remove whole <p>
  //      B. ... last sentence. See also: <a>...</a>.</p>  -- inline tail
  //         clause; remove just the See-also fragment, keep the parent
  //         <p>/<li> tag so prose stays well-formed.
  //    A "See also" mid-paragraph followed by more prose (no immediate
  //    </p> / </li>) is intentionally left alone -- it's editorial prose,
  //    not a closing clause.
  const bySlug = new Map(terms.map(t => [t.slug, t]));
  const SEE_ALSO_BLOCK = /\s*<p>\s*(?:<em>\s*)?[Ss]ee\s+also\b[\s\S]*?<\/p>/g;
  const SEE_ALSO_INLINE = /(?:\.\s*|\s+)(?:<em>\s*)?[Ss]ee\s+also[:\s]+(?:\s*<a\s[^>]+>[^<]+<\/a>[,;\.\s]*)+(?:<\/em>\s*)?(?=<\/p>|<\/li>)/g;
  let editorialTotal = 0;
  for (const t of terms) {
    const collected = [];
    const collect = (m) => {
      for (const s of [...m.matchAll(/href="#([a-z0-9-]+)"/gi)]) collected.push(s[1]);
      return '';
    };
    let body = t.bodyHtml.replace(SEE_ALSO_BLOCK, collect);
    body = body.replace(SEE_ALSO_INLINE, collect);
    t.bodyHtml = body;

    if (collected.length > 0) {
      // Fresh extraction from a bodyHtml that contained "See also". Resolve
      // slugs to known terms preserving order; dedupe; reject self.
      const seen = new Set([t.slug]);
      const editorial = [];
      for (const slug of collected) {
        if (seen.has(slug)) continue;
        const o = bySlug.get(slug);
        if (!o) continue;
        seen.add(slug);
        editorial.push({ slug: o.slug, name: o.name, part: o.part });
      }
      t.editorialRelated = editorial;
    } else if (!Array.isArray(t.editorialRelated)) {
      // First-time enrich on a term that has no "See also" -> empty.
      t.editorialRelated = [];
    }
    // Else: bodyHtml was already stripped by a prior enrich pass; keep the
    // previously-extracted editorialRelated. Full re-fetch (npm run
    // fetch-glossary) clears editorialRelated by replacing the term row
    // wholesale, so this preserve-path stays correct when D1 is the SSOT.
    editorialTotal += t.editorialRelated.length;
  }
  console.log(`enrich-glossary: ${editorialTotal} editorial "See also" picks across ${terms.filter(t => t.editorialRelated.length > 0).length} terms`);

  // 1. Auto-link cross-glossary mentions in each term body. Strip any prior
  //    gloss-xref anchors first so reruns are deterministic (D1 sees only
  //    the original bodyHtml; this script owns every gloss-xref insertion).
  let linksInjected = 0;
  const PRIOR_XREF = /<a\b[^>]*\bclass="[^"]*\bgloss-xref\b[^"]*"[^>]*>([^<]*)<\/a>/g;
  for (const t of terms) {
    t.bodyHtml = t.bodyHtml.replace(PRIOR_XREF, (_m, inner) => inner);
    const enriched = autoLinkBody(t.bodyHtml, t, aliasIndex);
    linksInjected += (enriched.match(/class="gloss-xref"/g) || []).length;
    t.bodyHtml = enriched;
  }
  console.log(`enrich-glossary: injected ${linksInjected} cross-glossary anchors across ${terms.length} bodies`);

  // 2. Build content backlink index from library, faqs, courses (NOT commentary -- citation policy).
  const recorder = buildBacklinkIndex(terms, aliasIndex);
  ingestArticles(articles, recorder);
  ingestFaqs(faqs, recorder);
  ingestCourses(courses, recorder);

  let totalBacklinks = 0;
  for (const t of terms) {
    const all = recorder.index.get(t.slug) || [];
    const byType = { library: [], faqs: [], courses: [] };
    for (const m of all) {
      if (byType[m.type]) byType[m.type].push(m);
    }
    for (const k of Object.keys(byType)) {
      byType[k].sort((a, b) => b.score - a.score);
      byType[k] = byType[k].slice(0, MAX_BACKLINKS_PER_TYPE).map(({ slug, title }) => ({ slug, title }));
      totalBacklinks += byType[k].length;
    }
    t.relatedContent = byType;
  }
  console.log(`enrich-glossary: indexed ${totalBacklinks} backlinks across all terms`);

  // 3. Related terms: editorial "See also" picks first (preserves curator
  //    sequence), then mention-graph + Part fallback fills the remaining
  //    slots. Deduped by slug, capped at MAX_RELATED_TERMS.
  const related = computeRelatedTerms(terms, aliasIndex);
  for (const t of terms) {
    const editorial = t.editorialRelated || [];
    const algorithmic = related.get(t.slug) || [];
    const seen = new Set();
    const merged = [];
    for (const r of [...editorial, ...algorithmic]) {
      if (seen.has(r.slug)) continue;
      seen.add(r.slug);
      merged.push(r);
      if (merged.length >= MAX_RELATED_TERMS) break;
    }
    t.relatedTerms = merged;
  }

  // 4. Per-term citations: scan bodyHtml for #ref-N anchors, hydrate from
  //    glossary.references. Sorted by ref_num. Lets each spoke render its own
  //    Sources list instead of jumping back to the pillar's master ref list.
  const refByNum = new Map();
  for (const r of (glossary.references || [])) {
    if (typeof r.refNum === 'number') refByNum.set(r.refNum, r);
  }
  let citedTotal = 0;
  for (const t of terms) {
    const seen = new Set();
    const re = /href="#ref-(\d+)"/g;
    let m;
    while ((m = re.exec(t.bodyHtml)) !== null) {
      const n = parseInt(m[1], 10);
      if (!Number.isFinite(n)) continue;
      seen.add(n);
    }
    const list = [...seen]
      .filter(n => refByNum.has(n))
      .sort((a, b) => a - b)
      .map(n => {
        const r = refByNum.get(n);
        return {
          refNum: n,
          anchorText: r.anchorText || '',
          url: r.url || null,
          publisher: r.publisher || null,
          journal: r.journal || null,
        };
      });
    t.citedReferences = list;
    citedTotal += list.length;
  }
  console.log(`enrich-glossary: attached ${citedTotal} per-term citation entries (avg ${(citedTotal / terms.length).toFixed(1)} per term)`);

  glossary.enrichedAt = new Date().toISOString();
  writeAtomic(GLOSSARY_PATH, glossary);
  console.log(`enrich-glossary: wrote ${GLOSSARY_PATH}`);
}

main().catch(err => {
  console.error('enrich-glossary failed:', err);
  process.exit(1);
});

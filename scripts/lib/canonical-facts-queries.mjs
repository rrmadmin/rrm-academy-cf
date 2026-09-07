/**
 * canonical-facts-queries.mjs -- the two D1 reads behind build-canonical-facts.mjs.
 *
 * They live here, apart from the script, because the script is a CLI that runs its whole
 * pipeline at module load: a test that imported it to read the SQL would execute a remote
 * D1 build as a side effect. Extracted 2026-09-07 so the source gate below could be tested
 * against a real SQLite engine with fixture rows.
 *
 * WHAT THE GATE IS FOR
 * --------------------
 * The facts read used to be `FROM facts WHERE verified >= 1` with no predicate on the source
 * article at all, and the article read admitted `status = 'classified'` and any `is_published
 * = 1` row. A canonical fact QUOTES the article it was extracted from, and the generated
 * JSON carries the source title, citation, DOI and URL beside it, so publishing a fact whose
 * source is archived, retracted or an excluded serving type republishes that withheld
 * article through the site build. rrm-library-worker closed the same hole on its agent-facing
 * read surfaces (`/articles`, `/content`, `/search`, `/related`, `GET /bodies`,
 * `POST /check-facts`); this is the site-build half of that contract, and it is deliberately
 * the same three-part test: published, not retracted, not an excluded type.
 *
 * The excluded-type list is IMPORTED from src/lib/excluded-types.mjs rather than retyped.
 * That file is the 11-type mirror of the worker's EXCLUDED_TYPES SSOT.
 *
 * SHAPE, AND WHY IT IS NOT `NOT EXISTS`
 * ------------------------------------
 * The slug arm is a set membership test, not a correlated `NOT EXISTS ... WHERE s.slug =
 * f.source_id COLLATE NOCASE`. `articles.slug` is UNIQUE with the default BINARY collation,
 * so an explicit COLLATE NOCASE cannot use that index and the correlated form re-scans every
 * article once per candidate fact. These queries run through `wrangler d1 execute --remote`
 * against the same production database that answered the correlated form with error 7429,
 * "exceeded its CPU time limit", on 2026-09-07 (rrm-library-worker PR #145). `lower()` on
 * both sides does the comparing COLLATE NOCASE did; slugs are ASCII.
 */

import { EXCLUDED_TYPES } from '../../src/lib/excluded-types.mjs';

/** SQL value-list for the excluded serving types, e.g. `('faq', 'post', ...)`. */
export const EXCLUDED_TYPES_SQL = `(${[...EXCLUDED_TYPES].map((t) => `'${t}'`).join(', ')})`;

/**
 * Facts the site may publish: verified, and sourced from an article the site may serve.
 *
 * The join is LEFT and a fact resolving to no article row passes through, matching the
 * worker: `facts.source_id` carries no foreign key, promote-facts documents it as optional
 * and accepts another fact's id, so a standalone fact has no withheld article behind it.
 * `a.type IS NULL OR` is load-bearing -- SQL `NULL NOT IN (...)` is NULL, not true, so
 * without it every legacy untyped source would drop out. `f.source_id IS NULL OR` is
 * load-bearing for the same reason on the slug arm.
 *
 * The slug arm exists because promote-facts rewrites a slug to the article id only when the
 * article exists at write time and stores the raw slug otherwise, so a fact can point at a
 * real withheld article by a token the id join never sees.
 */
export const FACTS_QUERY = `SELECT f.id, f.claim, f.category, f.domain, f.tradition, f.claim_type, f.body, f.source_id, f.verified, f.verification_notes, f.created_at, f.updated_at
 FROM facts f
 LEFT JOIN articles a ON a.id = f.source_id
 WHERE f.verified >= 1
   AND (a.id IS NULL
        OR (a.status = 'published' AND a.is_retracted = 0
            AND (a.type IS NULL OR a.type NOT IN ${EXCLUDED_TYPES_SQL})))
   AND (f.source_id IS NULL
        OR lower(f.source_id) NOT IN (
             SELECT lower(s.slug) FROM articles s
              WHERE s.status IS NOT 'published' OR s.is_retracted IS NOT 0
                 OR s.type IN ${EXCLUDED_TYPES_SQL}))`;

/**
 * Article metadata for source resolution: only rows the site may serve.
 *
 * Was `WHERE is_published = 1 OR status = 'classified' OR status = 'published'`. Nothing in
 * this repo documented why a classified (not yet published) row belonged in a published
 * SSOT's citations, and `is_published = 1` admitted retracted rows outright. Every fact the
 * query above returns resolves to a published, non-retracted article or to nothing, so a row
 * outside this set can only supply a citation for a fact that is no longer being emitted.
 */
export const ARTICLES_QUERY = `SELECT id, slug, title, authors, year, journal, pmid, doi, source_url, short_citation, type FROM articles WHERE status = 'published' AND is_retracted = 0`;

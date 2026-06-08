/**
 * Single source for public-facing asset counts used by /ai-instructions/ and its
 * .md twin, so the two never drift apart and never go stale against D1.
 *
 * libraryDisplay reuses the canonical, maintained library count
 * (src/data/library-stats.json, kept current by scripts/sync-library-count.mjs;
 * count is exact, displayCount is floored to displayFloor, e.g. "4,050+"). This
 * is the same value BaseLayout's WebMCP block, /connect, and /openapi already
 * show, so the whole site stays consistent.
 *
 * glossaryCount mirrors src/pages/glossary/index.astro (status === 'published');
 * there is no canonical glossary-stats file, so it is computed from the build
 * data each deploy.
 */
import libraryStats from '../data/library-stats.json';
import glossaryData from '../data/glossary.json';

export const libraryDisplay: string = libraryStats.displayCount;

export const glossaryCount: number = (
  ((glossaryData as { terms?: { status: string }[] }).terms) ?? []
).filter((t) => t.status === 'published').length;

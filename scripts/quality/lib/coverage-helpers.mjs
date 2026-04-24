/**
 * Shared coverage helpers used by crap.mjs and dashboard.mjs.
 */

/**
 * c8 --all produces a synthetic `(empty-report)` fnMap entry for files
 * that were never imported during tests. A file is "untouched" if its
 * only coverage entry is this synthetic placeholder.
 *
 * @param {Array<{name: string}>} covEntries - entries from loadCoverage()
 * @returns {boolean}
 */
export function isUntouched(covEntries) {
  return covEntries.length === 1 && covEntries[0]?.name === '(empty-report)';
}

/**
 * Compute average statement coverage for a file's function list,
 * filtering out synthetic empty-report entries.
 *
 * @param {Array<{name: string, coverage: number}>} covEntries
 * @returns {number} average coverage, 0.0–1.0
 */
export function avgCoverage(covEntries) {
  if (isUntouched(covEntries)) return 0;
  const real = covEntries.filter(e => e.name !== '(empty-report)');
  if (real.length === 0) return 1;
  return real.reduce((s, e) => s + e.coverage, 0) / real.length;
}

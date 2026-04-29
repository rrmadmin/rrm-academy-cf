/**
 * CRAP score calculator.
 * CRAP(f) = CC(f)² × (1 − coverage(f))³ + CC(f)
 *
 * Bands (industry convention; closed/open intervals are explicit):
 *   healthy    = [0, 5]     — CRAP ≤ 5
 *   acceptable = (5, 30]    — 5 < CRAP ≤ 30
 *   danger     = (30, ∞)    — CRAP > 30 (refactor or add tests)
 */

/**
 * Compute CRAP score for a function.
 * @param {number} complexity - cyclomatic complexity (CC), must be >= 1
 * @param {number} coverage - statement coverage fraction, 0.0–1.0
 * @returns {number} CRAP score
 */
export function crap(complexity, coverage) {
  if (!Number.isFinite(complexity) || complexity < 1) {
    throw new Error('complexity must be >= 1');
  }
  if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) {
    throw new Error('coverage must be in [0, 1]');
  }
  const uncovered = 1 - coverage;
  return complexity * complexity * (uncovered ** 3) + complexity;
}

/**
 * Classify a CRAP score into a band.
 * @param {number} score - CRAP score
 * @returns {'healthy' | 'acceptable' | 'danger'}
 */
export function bandFor(score) {
  if (score <= 5) return 'healthy';
  if (score <= 30) return 'acceptable';
  return 'danger';
}

/**
 * Shared markdown helpers.
 */

/**
 * Render a GitHub-flavored markdown table.
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows
 * @returns {string}
 */
export function mdTable(headers, rows) {
  if (headers.length === 0) return '';
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(r => `| ${r.map(cell => String(cell)).join(' | ')} |`).join('\n');
  return [head, sep, body].filter(Boolean).join('\n');
}

/**
 * Format a number to N decimal places, trimmed.
 */
export function fmt(n, decimals = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(decimals);
}

/**
 * Format a fraction as a percentage string with one decimal.
 */
export function pct(frac) {
  if (frac == null || Number.isNaN(frac)) return '—';
  return `${(frac * 100).toFixed(1)}%`;
}

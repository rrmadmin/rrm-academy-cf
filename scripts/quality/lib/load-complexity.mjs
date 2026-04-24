/**
 * Runs ESLint programmatically against src/lib/** with eslint.quality.config.js
 * and extracts per-function cyclomatic complexity from the 'complexity' rule
 * messages. Returns a map: { [absPath]: Array<{ line, column, name, cc }> }
 *
 * ESLint's 'complexity' rule message format:
 *   "Function '<name>' has a complexity of <N>."
 * or
 *   "Arrow function has a complexity of <N>."
 */
import { ESLint } from 'eslint';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

export async function loadComplexity() {
  const eslint = new ESLint({
    overrideConfigFile: resolve(ROOT, 'eslint.quality.config.js'),
    // ESLint's flat-config API; no need for `useEslintrc`.
  });

  const results = await eslint.lintFiles(['src/lib/**/*.{js,mjs,ts}']);
  const byFile = {};

  for (const r of results) {
    const entries = [];
    for (const m of r.messages) {
      if (m.ruleId !== 'complexity') continue;
      const match = m.message.match(/complexity of (\d+)/);
      if (!match) continue;
      const cc = Number(match[1]);
      const nameMatch = m.message.match(/^(?:Function|Method|Arrow function|Async function|Async arrow function|Generator function)(?: '([^']+)')?/);
      const name = nameMatch?.[1] ?? '<anonymous>';
      entries.push({ line: m.line, column: m.column, name, cc });
    }
    if (entries.length > 0) byFile[r.filePath] = entries;
  }

  return byFile;
}

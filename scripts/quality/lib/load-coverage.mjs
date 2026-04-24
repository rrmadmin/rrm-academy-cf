/**
 * Parses c8's coverage-final.json into per-function records.
 * c8 emits Istanbul-format JSON: { [absPath]: { fnMap, f, statementMap, s, ... } }
 *
 * fnMap: { [id]: { name, decl: {start:{line,column}, end:{...}}, loc: {...} } }
 * f:     { [id]: hitCount }   // function-level call count (NOT statement coverage)
 * statementMap: { [id]: { start: {line,column}, end: {...} } }
 * s:     { [id]: hitCount }   // per-statement hits
 *
 * We compute per-function statement coverage by finding statements whose
 * start line falls within the function's loc range, then covered = hits>0 / total.
 *
 * Returns: { [absPath]: Array<{ name, line, coverage }> }
 *   coverage = 1.0 if function has zero statements (trivial)
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const DEFAULT_PATH = resolve(ROOT, 'reports', 'quality', 'coverage', 'coverage-final.json');

export async function loadCoverage(jsonPath = DEFAULT_PATH) {
  const raw = await readFile(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  const byFile = {};

  for (const [absPath, fileData] of Object.entries(data)) {
    const { fnMap = {}, statementMap = {}, s = {} } = fileData;
    const entries = [];

    for (const [, fn] of Object.entries(fnMap)) {
      const startLine = fn.loc?.start?.line ?? fn.decl?.start?.line;
      const endLine = fn.loc?.end?.line ?? fn.decl?.end?.line;
      if (startLine == null || endLine == null) continue;

      let total = 0;
      let covered = 0;
      for (const [stmtId, stmt] of Object.entries(statementMap)) {
        const sl = stmt.start?.line;
        if (sl == null || sl < startLine || sl > endLine) continue;
        total += 1;
        if ((s[stmtId] ?? 0) > 0) covered += 1;
      }

      const coverage = total === 0 ? 1.0 : covered / total;
      entries.push({ name: fn.name || '<anonymous>', line: startLine, coverage });
    }

    if (entries.length > 0) byFile[absPath] = entries;
  }

  return byFile;
}

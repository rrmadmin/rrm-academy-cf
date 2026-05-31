export const VALID_STATUSES = new Set(['draft', 'published', 'archived']);
export const VALID_ACCESS_TYPES = new Set(['public', 'private', 'members']);
export const VALID_TYPES = new Set(['video', 'article', 'quiz']);
export const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function bool(v) {
  return (v === true || v === 1 || v === '1') ? 1 : 0;
}

export function groupBy(rows, key) {
  const map = {};
  for (const row of rows) {
    const k = row[key];
    if (!map[k]) map[k] = [];
    map[k].push(row);
  }
  return map;
}

export function parseJson(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function parseArray(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function parseObject(value) {
  const parsed = parseJson(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

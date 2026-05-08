// src/lib/shell-routes.ts
//
// Reads PUBLIC_SHELL_ROUTES at build time and reports whether a route
// (commentary, library, guides, faqs, account, ask, courses) is enabled
// in this build. Trim/lowercase tolerant — operator typos like
// "commentary, library" or "Library" don't silently disable the wrap.
//
// /courses/<slug>/<step>/ (lesson player) is INTENTIONALLY EXCLUDED from
// the wrap even when 'courses' is enabled — it keeps the existing
// course-taking UI. Only the catalog (/courses/) and sales pages
// (/courses/<slug>/) opt in (Brian preference 2026-05-08).
export type ShellRoute = 'commentary' | 'library' | 'guides' | 'faqs' | 'account' | 'ask' | 'courses';

export function isShellEnabled(route: ShellRoute): boolean {
  const raw = (import.meta.env.PUBLIC_SHELL_ROUTES || '') as string;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes(route);
}

// src/lib/shell-routes.ts
//
// Reads PUBLIC_SHELL_ROUTES at build time and reports whether a route
// (commentary, library, guides, faqs, account, ask, courses, community)
// is enabled in this build. Trim/lowercase tolerant — operator typos
// like "commentary, library" or "Library" don't silently disable the wrap.
//
// /courses/<slug>/<step>/ (lesson player) is INTENTIONALLY EXCLUDED from
// the wrap even when 'courses' is enabled — it keeps the existing
// course-taking UI. Only the catalog (/courses/) and sales pages
// (/courses/<slug>/) opt in (Brian preference 2026-05-08).
//
// /community/archive/* is also excluded — those are stale archive pages.
export type ShellRoute = 'commentary' | 'library' | 'guides' | 'faqs' | 'account' | 'ask' | 'courses' | 'community';

export function isShellEnabled(route: ShellRoute): boolean {
  const raw = (import.meta.env.PUBLIC_SHELL_ROUTES || '') as string;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes(route);
}

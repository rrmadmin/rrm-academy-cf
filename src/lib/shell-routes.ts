// src/lib/shell-routes.ts
//
// Reads PUBLIC_SHELL_ROUTES at build time and reports whether a route
// (commentary, library) is enabled in this build.
// Trim/lowercase tolerant — operator typos like "commentary, library" or
// "Library" don't silently disable the wrap.
export function isShellEnabled(route: 'commentary' | 'library'): boolean {
  const raw = (import.meta.env.PUBLIC_SHELL_ROUTES || '') as string;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes(route);
}

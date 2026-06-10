/**
 * Universal "save any page" — shared CLIENT logic.
 *
 * Spec: docs/superpowers/specs/2026-05-24-universal-saved-pages-design.md
 * (§3.1, §3.3, §3.5, §3.6, §3.7, §3.8, §3.9; INV-8/9/10/11).
 *
 * This module is Astro-BUNDLED (imported from a plain <script>, never is:inline)
 * so it can import the single source-of-truth url minter from src/lib/saved-url.mjs.
 * It owns: defensive read, merge-on-write, the cross-tab storage listener, the
 * rrm_saved_pending retry queue, the badge update path, and the shell "Save page"
 * toggle wiring. The /saved/ view imports the read/write/url primitives too.
 *
 * Client validation is a strict SUBSET of server validation (INV-11): a
 * client-accepted item always passes the server.
 */
import { canonicalSaveUrl, pageTypeFromUrl, SAVED_TYPES } from '../lib/saved-url.mjs';
import { PILLAR_PATHS } from '../lib/saved-pillars.mjs';

export { canonicalSaveUrl, pageTypeFromUrl, SAVED_TYPES };

const KEY = 'rrm_saved';
const PENDING_KEY = 'rrm_saved_pending';
const PENDING_DELETE_KEY = 'rrm_saved_pending_delete'; // L1: failed DELETE retry queue
const MAX_ITEMS = 500; // quota-eviction cap (§3.6)

// Legacy article-shape meta fields preserved across migration so RIS export
// survives (§3.3). New non-article saves simply lack them.
const META_FIELDS = [
  'authors', 'journal', 'journalAbbv', 'year', 'doi', 'pmid',
  'volume', 'issue', 'pages', 'datePublished', 'abstract', 'topics',
];

export interface SavedItem {
  url: string;
  title: string;
  type: string;
  savedAt: string;
  [k: string]: unknown;
}

function nowISO(): string {
  return new Date().toISOString();
}

function clampTitle(t: unknown): string {
  const s = (typeof t === 'string' ? t : '').trim();
  return s.length > 300 ? s.slice(0, 300) : s;
}

function pickMeta(src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of META_FIELDS) {
    if (src[f] !== undefined && src[f] !== null) out[f] = src[f];
  }
  return out;
}

/**
 * Fully defensive read of localStorage rrm_saved. NEVER throws (§3.3).
 * Migrates legacy article-shaped items ({slug,...} with no .url) in place,
 * keeping their meta fields so RIS export survives. Junk is dropped silently.
 */
export function readSaved(): SavedItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = JSON.parse(raw || '[]');
    if (!Array.isArray(arr)) return [];
    const out: SavedItem[] = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue; // drop junk
      const rec = item as Record<string, unknown>;
      if (typeof rec.url === 'string' && rec.url) {
        // Already page-shaped. Canonicalize defensively; drop if non-canonical.
        const u = canonicalSaveUrl(rec.url);
        if (!u) continue;
        const type = typeof rec.type === 'string' ? rec.type : (pageTypeFromUrl(u, PILLAR_PATHS) || 'article');
        out.push({
          ...rec,
          url: u,
          title: clampTitle(rec.title) || u,
          type,
          savedAt: typeof rec.savedAt === 'string' ? rec.savedAt : nowISO(),
        });
        continue;
      }
      if (typeof rec.slug === 'string' && rec.slug) {
        // Legacy article → upgrade to page shape, keeping meta.
        const u = canonicalSaveUrl('/library/' + rec.slug + '/');
        if (!u) continue;
        out.push({
          url: u,
          title: clampTitle(rec.title) || String(rec.slug),
          type: 'article',
          savedAt: typeof rec.savedAt === 'string' ? rec.savedAt : nowISO(),
          ...pickMeta(rec),
        });
      }
      // items with neither url nor usable slug are dropped (documented loss)
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Merge-on-write persistence (§3.6, fixes the two-tab clobber):
 * re-read localStorage synchronously, union the supplied items by url
 * (incoming wins), then setItem. On QuotaExceededError, evict oldest by
 * savedAt and cap at MAX_ITEMS. Returns the persisted array, or null on
 * unrecoverable failure (caller must NOT update in-memory/DOM in that case).
 */
export function writeSaved(items: SavedItem[]): SavedItem[] | null {
  try {
    // Re-read current localStorage to merge concurrent writes from other tabs.
    const current = readSaved();
    const byUrl = new Map<string, SavedItem>();
    for (const it of current) byUrl.set(it.url, it);
    for (const it of items) {
      if (it && typeof it.url === 'string' && it.url) byUrl.set(it.url, it);
    }
    let merged = Array.from(byUrl.values());
    // newest first
    merged.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));

    const persist = (arr: SavedItem[]) => localStorage.setItem(KEY, JSON.stringify(arr));
    try {
      persist(merged);
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) {
        // Evict oldest until it fits; hard cap at MAX_ITEMS.
        merged = merged.slice(0, MAX_ITEMS);
        while (merged.length > 0) {
          try {
            persist(merged);
            break;
          } catch {
            merged.pop(); // drop oldest (already sorted newest-first)
          }
        }
      } else {
        throw e;
      }
    }
    return merged;
  } catch {
    return null;
  }
}

/**
 * Replace localStorage entirely with an authoritative set (logged-in server
 * read, §3.7/INV-10). Quota-guarded like writeSaved. Returns persisted array
 * or null on failure.
 */
export function replaceSaved(items: SavedItem[]): SavedItem[] | null {
  try {
    let arr = items.slice().sort((a, b) =>
      String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
    const persist = (a: SavedItem[]) => localStorage.setItem(KEY, JSON.stringify(a));
    try {
      persist(arr);
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) {
        arr = arr.slice(0, MAX_ITEMS);
        while (arr.length > 0) {
          try { persist(arr); break; } catch { arr.pop(); }
        }
      } else {
        throw e;
      }
    }
    return arr;
  } catch {
    return null;
  }
}

/**
 * Adopt an authoritative server set WITHOUT clobbering concurrent optimistic
 * local saves (M4). Re-reads localStorage, unions any LOCAL-ONLY urls (those
 * not present in the server set) on top of the server set, then persists.
 *
 * Rationale: the badge-sync runs deferred/idle; a user can tap Save on the
 * current page in the window between the GET firing and resolving. A blind
 * `setItem(serverSet)` would drop that optimistic save. The push-then-adopt
 * flow already pushes local saves up, but a save made AFTER the push (or one
 * that failed to push) would still be lost without this union. Server wins on
 * identity for urls it knows; local-only urls are preserved.
 *
 * Returns the persisted array, or null on unrecoverable failure.
 */
export function adoptServerSet(serverItems: SavedItem[]): SavedItem[] | null {
  try {
    // L2: never re-adopt a url the user just unsaved. The server snapshot may
    // predate the DELETE; the tombstone keeps it removed until the delete is
    // confirmed-and-pruned (or lifted on re-save).
    const tomb = pendingDeleteSet();
    const byUrl = new Map<string, SavedItem>();
    // Start from the server set (authoritative for urls it contains).
    for (const it of serverItems) {
      if (it && typeof it.url === 'string' && it.url && !tomb.has(it.url)) byUrl.set(it.url, it);
    }
    // Union local-only urls (preserve concurrent optimistic saves).
    for (const it of readSaved()) {
      if (it && typeof it.url === 'string' && it.url && !byUrl.has(it.url)) {
        byUrl.set(it.url, it);
      }
    }
    return replaceSaved(Array.from(byUrl.values()));
  } catch {
    return null;
  }
}

/** Auth-hint cookie (set whenever a session is minted). No PII. */
export function hasAuthHint(): boolean {
  try {
    return document.cookie.split(';').some((c) => c.trim().indexOf('rrm_auth=1') === 0);
  } catch {
    return false;
  }
}

// ---- Server shape mapping (the API returns minimal {url,title,type,savedAt}) ----

interface ServerPage { url?: unknown; title?: unknown; type?: unknown; savedAt?: unknown; }
interface LegacyArticle { slug?: unknown; title?: unknown; savedAt?: unknown; [k: string]: unknown; }

/**
 * Map a /api/saved GET response into page-shaped items. Prefers `pages`;
 * falls back to mapping legacy `articles` (slug→url) for backward compat.
 */
export function serverSetFromResponse(result: {
  pages?: ServerPage[];
  articles?: LegacyArticle[];
} | null): SavedItem[] {
  if (!result) return [];
  if (Array.isArray(result.pages)) {
    const out: SavedItem[] = [];
    for (const p of result.pages) {
      if (!p || typeof p.url !== 'string') continue;
      const u = canonicalSaveUrl(p.url);
      if (!u) continue;
      out.push({
        url: u,
        title: clampTitle(p.title) || u,
        type: typeof p.type === 'string' ? p.type : (pageTypeFromUrl(u, PILLAR_PATHS) || 'article'),
        savedAt: typeof p.savedAt === 'string' ? p.savedAt : nowISO(),
      });
    }
    return out;
  }
  if (Array.isArray(result.articles)) {
    const out: SavedItem[] = [];
    for (const a of result.articles) {
      if (!a || typeof a.slug !== 'string') continue;
      const u = canonicalSaveUrl('/library/' + a.slug + '/');
      if (!u) continue;
      out.push({
        url: u,
        title: clampTitle(a.title) || String(a.slug),
        type: 'article',
        savedAt: typeof a.savedAt === 'string' ? a.savedAt : nowISO(),
        ...pickMeta(a as Record<string, unknown>),
      });
    }
    return out;
  }
  return [];
}

// ---- Pending retry queue (§3.6 / CMD-6) ----

function readPending(): SavedItem[] {
  try {
    const arr = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => x && typeof x === 'object' && typeof x.url === 'string');
  } catch {
    return [];
  }
}

function writePending(arr: SavedItem[]): void {
  try {
    if (arr.length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

export function queuePending(item: SavedItem): void {
  const pend = readPending();
  const byUrl = new Map<string, SavedItem>();
  for (const p of pend) byUrl.set(p.url, p);
  byUrl.set(item.url, item);
  writePending(Array.from(byUrl.values()));
}

/** Drop a queued save (mirrors dequeuePendingDelete): the user unsaved a url
 *  whose failed POST is still pending, so flushing it later would resurrect
 *  the item. */
export function dequeuePending(url: string): void {
  if (typeof url !== 'string' || !url) return;
  const pend = readPending();
  const next = pend.filter((p) => p.url !== url);
  if (next.length !== pend.length) writePending(next);
}

/** Chunk an array into ≤size pieces (server caps batch at 100, §3.4/§3.8). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toServerPage(it: SavedItem): { url: string; title: string } {
  return { url: it.url, title: it.title };
}

/**
 * POST a batch of pages to the server in chunks of ≤100, partitioned by
 * response class (H6/M8):
 *  - 2xx chunk  → those items succeeded; PRUNE them (drop from pending).
 *  - 4xx chunk  → permanent (poison) — those items will NEVER sync; DROP them
 *                 too (terminal, mirror the toggle's 4xx discriminator). Leaving
 *                 them in the queue would retry a guaranteed-failing request
 *                 forever.
 *  - 5xx / network → transient; KEEP those items pending for the next flush.
 * Returns the array of items that must STAY pending (only the 5xx/network set).
 * A returned empty array means the queue can be cleared.
 */
async function postBatch(items: SavedItem[]): Promise<SavedItem[]> {
  const keepPending: SavedItem[] = [];
  for (const part of chunk(items, 100)) {
    try {
      const res = await fetch('/api/saved', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages: part.map(toServerPage) }),
      });
      if (res.ok) continue; // 2xx → prune this chunk
      if (res.status >= 400 && res.status < 500) {
        // 4xx → terminal poison; drop (do NOT keep pending).
        continue;
      }
      // 5xx (or any other non-2xx) → transient; retry this chunk later.
      for (const it of part) keepPending.push(it);
    } catch {
      // Network failure → transient; retry this chunk later.
      for (const it of part) keepPending.push(it);
    }
  }
  return keepPending;
}

/**
 * Flush rrm_saved_pending to the server (chunked). Called on every shell page
 * load when logged in (§3.6). Prunes succeeded + poison (4xx) items per chunk;
 * only 5xx/network failures stay queued for the next load (H6/M8).
 */
export async function flushPending(): Promise<void> {
  if (!hasAuthHint()) return;
  const pend = readPending();
  if (pend.length === 0) return;
  const stillPending = await postBatch(pend);
  // Persist the reduced queue (empty when everything resolved or was poison).
  writePending(stillPending);
}

/**
 * Deferred badge-sync for the global Header (H4/H5/M3/M4 — single source). For
 * logged-in users: push any local saves up (chunked, ALL of them, not just the
 * first 100 — M3), then GET the authoritative server set and adopt it via the
 * merge-on-write union (M4, never clobbers a concurrent optimistic save), then
 * update the badge. Anonymous users keep localStorage only. Guards `res.ok`
 * before `.json()` (M6). Fully defensive; never throws.
 *
 * Replaces the Header's inline canon()/serverSet()/adopt()/slice(0,100) copies
 * so the minter, the server-shape mapper, and the merge logic live in exactly
 * one place (INV-1).
 */
export async function syncBadgeFromServer(): Promise<void> {
  if (!hasAuthHint()) return;
  try {
    // Push local saves up first (additive, chunked, ALL of them — M3).
    const local = readSaved();
    if (local.length > 0) {
      // postBatch chunks at ≤100/request and loops every chunk; INSERT OR
      // IGNORE on the server makes this additive. Failures are tolerated — the
      // subsequent GET still reflects whatever did land, and rrm_saved_pending
      // (flushed on shell load) covers durable retries.
      await postBatch(local);
    }
    const res = await fetch('/api/saved', { credentials: 'same-origin' });
    if (!res.ok) return; // M6: don't feed a non-2xx to .json(); keep localStorage
    let result: { ok?: boolean; pages?: unknown; articles?: unknown } | null = null;
    try {
      result = await res.json();
    } catch {
      return; // malformed body — keep localStorage fallback
    }
    if (!result || !result.ok) return;
    const serverItems = serverSetFromResponse(
      result as { pages?: ServerPage[]; articles?: LegacyArticle[] }
    );
    // M4: union local-only urls so a save made during the in-flight GET is not
    // clobbered. Server wins on identity for urls it knows.
    const persisted = adoptServerSet(serverItems);
    updateBadge((persisted || readSaved()).length);
  } catch {
    /* keep localStorage; next load retries */
  }
}

// ---- Pending DELETE retry queue (L1) ----
//
// Without this, a DELETE that fails (5xx/network) while the optimistic local
// removal already happened leaves the server row alive — on the next read the
// authoritative server set resurrects the unsaved item. The queue holds the
// urls to delete and is flushed on every shell page load (logged in).

function readPendingDelete(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(PENDING_DELETE_KEY) || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => typeof x === 'string' && x);
  } catch {
    return [];
  }
}

function writePendingDelete(urls: string[]): void {
  try {
    if (urls.length === 0) localStorage.removeItem(PENDING_DELETE_KEY);
    else localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(urls));
  } catch {
    /* ignore */
  }
}

/** Enqueue a url whose server DELETE failed (dedup by url). */
export function queuePendingDelete(url: string): void {
  if (typeof url !== 'string' || !url) return;
  const set = new Set(readPendingDelete());
  set.add(url);
  writePendingDelete(Array.from(set));
}

/** Lift a tombstone (e.g. the user re-saved a url they had just unsaved). */
export function dequeuePendingDelete(url: string): void {
  if (typeof url !== 'string' || !url) return;
  const set = new Set(readPendingDelete());
  if (set.delete(url)) writePendingDelete(Array.from(set));
}

/**
 * Snapshot of the pending-delete tombstones (urls removed locally whose server
 * removal isn't yet confirmed-and-pruned). Every server-reconcile/adopt path
 * filters these out so a stale GET snapshot — one issued BEFORE an optimistic
 * unsave — cannot resurrect a just-removed item (L2: the same-load delete race
 * that L1's failed-DELETE-only queue did not cover). Pruned on a later shell
 * load by flushPendingDelete once the DELETE confirms, or lifted immediately by
 * dequeuePendingDelete on re-save.
 */
export function pendingDeleteSet(): Set<string> {
  return new Set(readPendingDelete());
}

/**
 * DELETE a single url on the server, classifying the outcome (L1, mirrors
 * postBatch's response-class partition):
 *  - 2xx           → deleted; prune.
 *  - 4xx           → terminal (already gone / invalid); prune (do NOT retry).
 *  - 5xx / network → transient; KEEP pending.
 * Returns true if the url should stay pending (5xx/network only).
 */
async function deleteOne(url: string): Promise<boolean> {
  try {
    const res = await fetch('/api/saved', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (res.ok) return false;
    if (res.status >= 400 && res.status < 500) return false; // terminal
    return true; // 5xx → retry later
  } catch {
    return true; // network → retry later
  }
}

/**
 * Issue a server DELETE and, on transient failure, enqueue the url for retry
 * (L1). Use this everywhere a logged-in unsave hits the server so a failed
 * DELETE can never silently resurrect on the next authoritative read.
 */
export async function serverDelete(url: string): Promise<void> {
  if (!hasAuthHint()) return;
  // L2: tombstone FIRST, before awaiting the network. A reconcile GET issued
  // before this unsave will still return the url in its snapshot; the tombstone
  // makes every adopt/reconcile path drop it so it can't be resurrected. The
  // tombstone is pruned on a later shell load by flushPendingDelete once the
  // DELETE confirms (and re-queued there anyway on transient failure).
  queuePendingDelete(url);
  await deleteOne(url);
}

/**
 * Flush rrm_saved_pending_delete to the server (L1). Called on every shell page
 * load when logged in. Prunes succeeded + terminal (4xx); keeps 5xx/network.
 */
export async function flushPendingDelete(): Promise<void> {
  if (!hasAuthHint()) return;
  const pend = readPendingDelete();
  if (pend.length === 0) return;
  const stillPending: string[] = [];
  for (const url of pend) {
    const keep = await deleteOne(url);
    if (keep) stillPending.push(url);
  }
  writePendingDelete(stillPending);
}

// ---- Badge / count update path (§3.9) ----

/**
 * Update the save-count surface from a count:
 *  - desktop sidebar Save iconbtn count (shell-saved-count). The legacy global
 *    Header badge (saved-link/saved-count + mobile-*) was removed in ab2ea146;
 *    no other surface exists.
 */
export function updateBadge(count: number): void {
  const shellCount = document.getElementById('shell-saved-count');
  if (shellCount) {
    shellCount.textContent = count > 0 ? String(count) : '';
    shellCount.classList.toggle('has-items', count > 0);
  }
}

// ---- Shell "Save page" toggle wiring (§3.6, INV-8) ----

/**
 * Strip trailing "| RRM <Word>" suffixes from a document title. BaseLayout
 * appends "| RRM Academy", but some templates append other " | RRM <Word>"
 * variants (e.g. "| RRM Research Library", "| RRM Glossary"), and a few stack
 * more than one. Loop until no further suffix is removed (defense-in-depth).
 */
function stripRrmSuffix(raw: string): string {
  let t = (raw || '').trim();
  // Match a trailing " | RRM <one-or-more capitalized words>" at the end.
  const re = /\s*\|\s*RRM(?:\s+[A-Z][\w-]*)*\s*$/;
  let prev: string;
  do {
    prev = t;
    t = t.replace(re, '').trim();
  } while (t !== prev && t.length > 0);
  return t;
}

function resolveTitle(btn: HTMLElement): string {
  const attr = btn.getAttribute('data-save-title');
  let t = clampTitle(attr);
  if (t) return t;
  t = clampTitle(stripRrmSuffix(document.title));
  if (t) return t;
  // Strip failed to leave anything (title was just the suffix); try the raw
  // document title before falling through to the URL segment.
  t = clampTitle(document.title);
  if (t) return t;
  // last URL segment fallback
  const u = canonicalSaveUrl(location.pathname) || '';
  const segs = u.split('/').filter(Boolean);
  const seg = segs.length ? clampTitle(segs[segs.length - 1].replace(/-/g, ' ')) : '';
  // Guarantee non-empty (the server rejects empty titles; INV-11 subset).
  return seg || 'Saved page';
}

function paintToggle(btn: HTMLElement, isSaved: boolean): void {
  btn.classList.toggle('is-saved', isSaved);
  btn.setAttribute('aria-pressed', String(isSaved));
  const label = btn.querySelector('.shell-save-toggle__label');
  if (label) label.textContent = isSaved ? 'Saved' : 'Save page';
  btn.setAttribute('aria-label', isSaved ? 'Remove from saved' : 'Save this page');
  btn.setAttribute('title', isSaved ? 'Saved' : 'Save page');
}

/**
 * Move the Save toggle onto the page's breadcrumb line so it integrates with the
 * existing page furniture (crumbs left, Save right) instead of floating alone at
 * the top of the content column. Every saveable page type (article, commentary,
 * faq, glossary, pillar, condition) leads with a `.breadcrumb`, so this is the
 * one universal anchor. Wraps the breadcrumb + button in a `.breadcrumb-bar`
 * flex row (CSS in app-shell.css) and drops the now-empty `.shell-save-row`
 * placeholder. Idempotent; fully defensive. If no breadcrumb is found the button
 * stays in `.shell-save-row` (right-aligned fallback) so the feature never
 * silently disappears. Runs while the button is still `hidden`, so no flash.
 */
function relocateSaveIntoBreadcrumb(btn: HTMLElement): void {
  try {
    if (btn.closest('.breadcrumb-bar')) return; // already relocated
    const main = document.querySelector('.app-shell-main');
    if (!main) return;
    const bc = main.querySelector('.breadcrumb');
    if (!bc || !bc.parentElement) return; // no anchor — keep fallback placement
    const bar = document.createElement('div');
    bar.className = 'breadcrumb-bar';
    bar.setAttribute('data-pagefind-ignore', 'all');
    bc.parentElement.insertBefore(bar, bc);
    bar.appendChild(bc); // crumbs first (left)
    bar.appendChild(btn); // Save second (right)
    // Drop the now-empty top placeholder so it leaves no dead vertical space.
    const row = document.querySelector('.shell-save-row');
    if (row && !row.contains(btn)) row.remove();
  } catch {
    /* keep the fallback placement */
  }
}

/**
 * Initialize the shell Save toggle + badge + cross-tab listener + pending flush.
 * Idempotent-ish: safe to call once per shell page.
 */
export function initSavedShell(): void {
  // Badge first (instant from localStorage, no network).
  const initial = readSaved();
  updateBadge(initial.length);

  const btn = document.getElementById('shell-save-toggle');
  // INV-8: the toggle is only present + enabled on saveable pages. The Astro
  // side renders it only when pageTypeFromUrl(canonicalSaveUrl(path)) !== null,
  // but re-assert here so a stale SSR can never produce a live-but-unsaveable
  // control.
  const url = canonicalSaveUrl(location.pathname);
  const type = url ? pageTypeFromUrl(url, PILLAR_PATHS) : null;

  if (btn && (!url || !type)) {
    btn.hidden = true;
  }

  if (btn && url && type) {
    // Integrate into the breadcrumb row BEFORE revealing (no flash).
    relocateSaveIntoBreadcrumb(btn);
    btn.hidden = false;
    let isSaved = readSaved().some((it) => it.url === url);
    paintToggle(btn, isSaved);

    btn.addEventListener('click', () => {
      const title = resolveTitle(btn);
      const loggedIn = hasAuthHint();
      if (isSaved) {
        // Unsave: optimistic local remove + DELETE. Drop any queued failed
        // save first so a later flush can't resurrect the item.
        dequeuePending(url);
        const remaining = readSaved().filter((it) => it.url !== url);
        const persisted = replaceSaved(remaining);
        if (persisted) {
          isSaved = false;
          paintToggle(btn, false);
          updateBadge(persisted.length);
        }
        if (loggedIn) {
          // L1: serverDelete enqueues on transient failure so a dropped DELETE
          // can't resurrect this url on the next authoritative read.
          serverDelete(url).catch(() => { /* queued; retried next load */ });
        }
      } else {
        // Save: optimistic local add via merge-on-write. Lift any stale
        // tombstone first so re-saving a just-unsaved url isn't filtered back
        // out by the reconcile's pending-delete guard (L2).
        dequeuePendingDelete(url);
        const item: SavedItem = { url, title, type, savedAt: nowISO() };
        const persisted = writeSaved([item]);
        if (persisted) {
          isSaved = true;
          paintToggle(btn, true);
          updateBadge(persisted.length);
        }
        if (loggedIn) {
          fetch('/api/saved', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ page: { url, title } }),
          })
            .then((res) => {
              if (res.ok) return;
              if (res.status >= 400 && res.status < 500) {
                // Validation failure: the item will never sync — REVERT the
                // optimistic add (§3.6). Only flip the visual + badge if the
                // persist actually succeeded (M5: guard like the save path so a
                // failed replaceSaved doesn't desync the UI from localStorage).
                const remaining = readSaved().filter((it) => it.url !== url);
                const after = replaceSaved(remaining);
                if (after) {
                  isSaved = false;
                  paintToggle(btn, false);
                  updateBadge(after.length);
                }
              } else {
                // 5xx / transient: keep local, queue for retry.
                queuePending(item);
              }
            })
            .catch(() => {
              // Network failure: keep local optimistic add, queue for retry.
              queuePending(item);
            });
        }
      }
    });

    // Cross-tab sync: re-paint toggle + badge when another tab mutates rrm_saved
    // (mirror the existing rrm_theme cross-tab listener in AppShellChrome).
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY) return;
      const set = readSaved();
      isSaved = set.some((it) => it.url === url);
      paintToggle(btn, isSaved);
      updateBadge(set.length);
    });
  } else {
    // No toggle on this page (or unsaveable) — still keep the badge cross-tab synced.
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY) return;
      updateBadge(readSaved().length);
    });
  }

  // Logged-in: flush any pending failed deletes (L1) FIRST, then pending
  // failed writes (§3.6 / CMD-6), so a delete-then-resave sequence can't
  // race. Fire-and-forget; both retried on the next shell load.
  if (hasAuthHint()) {
    flushPendingDelete()
      .catch(() => { /* retried next load */ })
      .then(() => flushPending())
      .catch(() => { /* retried next load */ });
  }
}

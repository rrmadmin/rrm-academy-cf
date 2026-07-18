/**
 * Shared pure helpers for the membership report. No network, no bindings;
 * every function here is unit-testable in isolation (G1). Prefixed with _ so
 * CF Pages does not treat it as a route.
 *
 * Predicates ported from rrm-observatory (separate repo, so duplication with a
 * cross-reference is accepted, do not invent a shared module):
 *   - invoiceDropout()  <- src/digest/donors.js invoiceDropout()
 *   - parseDbTs(), subStartEpochMs(), lapse logic, KNOWN_PAUSED
 *                       <- src/daemons/stuc-label-drift.js
 */

export const LAPSE_MAX_DAYS = 45;
export const NEW_MEMBER_GRACE_DAYS = 14;
const DAY_MS = 86_400_000;

// Deliberate, Brian-approved comp/pause (never a dropout). Mirror of the
// observatory KNOWN_PAUSED allowlist (stuc-label-drift.js), extended with a
// display name so the dashboard never has to render a raw email address.
export const KNOWN_PAUSED = [
  { email: 'vjgbergin@gmail.com', name: 'Victoria Bergin', note: 'Paused / comped (Brian approved).' },
];

export function centsInt(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? v : 0;
}

// --- ET month boundaries ------------------------------------------------
// Wall-clock ET midnight for a Y-M-D, resolved to the correct UTC instant.
// Uses Intl to read the ET offset at the guessed instant (handles EST/EDT).
function etOffsetMs(utcMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - utcMs;
}

function etMidnightUtcMs(year, month /* 1-12 */, day = 1) {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offset = etOffsetMs(guess);
  return guess - offset;
}

export function monthBoundsET(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) throw new Error('invalid month');
  const y = +m[1], mo = +m[2];
  if (mo < 1 || mo > 12) throw new Error('invalid month');
  const startMs = etMidnightUtcMs(y, mo, 1);
  const nY = mo === 12 ? y + 1 : y, nMo = mo === 12 ? 1 : mo + 1;
  const endMs = etMidnightUtcMs(nY, nMo, 1);
  const pY = mo === 1 ? y - 1 : y, pMo = mo === 1 ? 12 : mo - 1;
  const prevStartMs = etMidnightUtcMs(pY, pMo, 1);
  return {
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(endMs).toISOString(),
    prevStartUtc: new Date(prevStartMs).toISOString(),
    prevEndUtc: new Date(startMs).toISOString(),
    label: `${m[1]}-${m[2]}`,
  };
}

// Current ET calendar month as 'YYYY-MM'.
function currentEtMonth(nowMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(nowMs))) p[part.type] = part.value;
  return `${p.year}-${p.month}`;
}

// Months between two 'YYYY-MM' (a - b), positive when a is later.
function monthDiff(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (ay - by) * 12 + (am - bm);
}

export function validateMonthParam(raw, nowMs, maxBack = 24) {
  const cur = currentEtMonth(nowMs);
  if (raw == null || raw === '') return cur;
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;
  const mo = +raw.slice(5);
  if (mo < 1 || mo > 12) return null;
  const diff = monthDiff(cur, raw); // >0 = in the past
  if (diff < 0) return null;        // future month
  if (diff > maxBack) return null;  // too far back
  return raw;
}

// --- roster partition ---------------------------------------------------
// Precedence staff > legacy > stripe > wix guarantees a mutually-exclusive
// partition so the invariant (sum == rosterTotal) holds. Stripe wins over Wix
// for a mid-migration member matching both (spec).
export function partitionRoster(rows) {
  let staff_count = 0, legacy_count = 0, stripe_count = 0, wix_count = 0;
  for (const r of rows) {
    const isStaff = ['mod', 'admin', 'superadmin'].includes(r.role);
    if (isStaff) { staff_count++; continue; }
    if (r.has_legacy) { legacy_count++; continue; }
    if (r.has_stripe) { stripe_count++; continue; }
    if (r.has_wix) { wix_count++; continue; }
    // A roster row matching none of the paying/complimentary branches should
    // never reach here because STUC_MEMBER_WHERE is exactly those branches;
    // count it as staff-adjacent 'other' would break the invariant, so treat
    // an unclassifiable row as legacy (complimentary) to keep the partition total.
    legacy_count++;
  }
  return {
    staff_count, legacy_count, stripe_count, wix_count,
    rosterTotal: staff_count + legacy_count + stripe_count + wix_count,
  };
}

// --- ported Stripe predicates ------------------------------------------
export function invoiceDropout(sub) {
  const inv = sub && sub.latest_invoice;
  if (!inv || typeof inv !== 'object') return false;
  if (inv.status !== 'void' && inv.status !== 'uncollectible') return false;
  const amountPaid = Number(inv.amount_paid);
  if (Number.isFinite(amountPaid) && amountPaid > 0) return false;
  if (inv.billing_reason === 'subscription_create' && Number(inv.amount_due) === 0) return false;
  return true;
}

export function isDunningDropout(sub) {
  return sub && (sub.status === 'past_due' || sub.status === 'unpaid');
}

export function subStartEpochMs(sub) {
  const raw = Number.isFinite(sub?.start_date) ? sub.start_date : sub?.created;
  return Number.isFinite(raw) ? raw * 1000 : NaN;
}

// --- ported lapse scan (parseDbTs + 45d/14d grace) ---------------------
export function parseDbTs(value) {
  if (typeof value !== 'string' || !value) return NaN;
  let s = value;
  if (value.includes(' ') && !value.includes('T')) {
    s = value.replace(' ', 'T') + (/(Z|[+-]\d\d:?\d\d)$/.test(value) ? '' : 'Z');
  }
  return Date.parse(s);
}

// giftRows: [{ email, last_gift_at, created_at }]; subStartByEmail: Map(lowerEmail -> epochMs)
export function computeLapsed({ giftRows, subStartByEmail, nowMs }) {
  const starts = subStartByEmail instanceof Map ? subStartByEmail : new Map();
  const paused = new Set(KNOWN_PAUSED.map(e => e.email.toLowerCase()));
  const flagged = [];
  for (const row of giftRows) {
    const email = String(row.email || '').trim();
    if (!email || paused.has(email.toLowerCase())) continue;
    const subStartMs = starts.get(email.toLowerCase());
    const lastMs = parseDbTs(row.last_gift_at);
    if (Number.isFinite(lastMs)) {
      const days = Math.floor((nowMs - lastMs) / DAY_MS);
      if (days > LAPSE_MAX_DAYS) {
        const resubscribedRecently = Number.isFinite(subStartMs)
          && subStartMs > lastMs
          && (nowMs - subStartMs) / DAY_MS < NEW_MEMBER_GRACE_DAYS;
        if (!resubscribedRecently) flagged.push({ email, days });
      }
    } else if (Number.isFinite(subStartMs)) {
      if ((nowMs - subStartMs) / DAY_MS > NEW_MEMBER_GRACE_DAYS) flagged.push({ email, days: null });
    } else {
      const createdMs = parseDbTs(row.created_at);
      if (Number.isFinite(createdMs) && (nowMs - createdMs) / DAY_MS > NEW_MEMBER_GRACE_DAYS) {
        flagged.push({ email, days: null });
      }
    }
  }
  return flagged;
}

// --- anticipated renewals (r4 addendum) --------------------------------
// Date-aware estimate: sum the monthly amount of every active paying sub whose
// single next renewal is scheduled inside the remainder of the reporting month
// (window [nowMs, monthEndMs)). Window filtering is done here in JS (not SQL) so
// this stays a pure, fully unit-testable function. Stripe wins over Wix for a
// mid-migration email present in both (same precedence as partitionRoster).
// candidates: [{ email, amount_cents, next_renewal_ms, source }]
export function anticipatedRenewalsCents({ candidates, nowMs, monthEndMs, excludeEmails }) {
  const exclude = excludeEmails instanceof Set ? excludeEmails : new Set();
  const byEmail = new Map();
  for (const c of candidates || []) {
    const email = String(c.email || '').trim().toLowerCase();
    if (!email || exclude.has(email)) continue;
    const t = c.next_renewal_ms;
    if (!Number.isFinite(t) || t < nowMs || t >= monthEndMs) continue;
    if (byEmail.has(email) && c.source !== 'stripe') continue; // do not overwrite Stripe with Wix
    byEmail.set(email, centsInt(c.amount_cents));
  }
  let sum = 0;
  for (const v of byEmail.values()) sum += v;
  return sum;
}

// --- response builder (schema contract) --------------------------------
export function assembleReport(input) {
  const {
    generatedAt, month, rosterRows, priorRecurringCents, supporterEmails,
    joined, left, watchlist, knownPaused, foundation, academy, actions, trend,
    stripeUnavailable, mom,
  } = input;

  const part = partitionRoster(rosterRows);

  // active_by_tier + monthly_cents from the two PAYING branches only
  // (stripe + wix); staff + legacy are complimentary and excluded.
  const active_by_tier = { member: 0, hero: 0, superhero: 0 };
  let monthly_cents = 0;
  for (const r of rosterRows) {
    const isStaff = ['mod', 'admin', 'superadmin'].includes(r.role);
    if (isStaff || r.has_legacy) continue;      // complimentary, not counted
    if (!r.has_stripe && !r.has_wix) continue;   // paying branches only
    const tier = ['member', 'hero', 'superhero'].includes(r.tier) ? r.tier : 'member';
    active_by_tier[tier]++;
    monthly_cents += centsInt(r.monthly_cents);
  }

  // total_supporters = distinct lowercased emails across paying roster
  // + non-refunded donor_gift givers in the month + course buyers in the month
  // (all folded into supporterEmails upstream). One human counts once.
  const distinct = new Set();
  for (const e of supporterEmails) {
    if (e) distinct.add(String(e).trim().toLowerCase());
  }
  const total_supporters = distinct.size;

  const recurring_monthly_cents = centsInt(monthly_cents);
  const degraded = !!stripeUnavailable;
  // A partial headline must never render as a real drop against baseline.
  // The delta compares current roster MRR to last month's realized membership
  // receipts (donor_gift kind='membership'), because no historical MRR
  // snapshot exists to diff against. delta_basis discloses this so renderers
  // must phrase it as "vs last month's membership receipts", not "vs last
  // month's MRR". Always present, even when the delta itself is nulled.
  const delta_vs_prior_month_cents = degraded
    ? null
    : recurring_monthly_cents - centsInt(priorRecurringCents);
  const delta_basis = 'prior_month_membership_receipts';

  // Month-over-month (r4): a true like-for-like comparison. Receipts are the
  // same donor_gift membership series both months (so the numbers are the same
  // quantity, unlike the legacy delta which compared today's roster MRR against
  // last month's realized receipts). receipts_anticipated_cents is the
  // date-aware current-month estimate (collected so far + scheduled renewals
  // still to land this month); it is null for a completed month. All inputs are
  // computed by the endpoint (D1 + Stripe) and passed in; this stays pure.
  const m = mom || {};
  const headlineMom = {
    receipts_this_month_cents: centsInt(m.receipts_this_month_cents),
    receipts_prior_month_cents: centsInt(m.receipts_prior_month_cents),
    receipts_anticipated_cents: m.receipts_anticipated_cents == null ? null : centsInt(m.receipts_anticipated_cents),
    supporters_this_month: Math.max(0, Math.round(m.supporters_this_month) || 0),
    supporters_prior_month: Math.max(0, Math.round(m.supporters_prior_month) || 0),
    month_in_progress: !!m.month_in_progress,
  };

  return {
    generated_at: generatedAt,
    month,
    headline: { total_supporters, recurring_monthly_cents, delta_vs_prior_month_cents, delta_basis, mom: headlineMom, degraded },
    stuc: {
      active_by_tier,
      monthly_cents: recurring_monthly_cents,
      wix_count: part.wix_count,
      stripe_count: part.stripe_count,
      legacy_count: part.legacy_count,
      staff_count: part.staff_count,
      joined_this_month: joined,
      left_this_month: left,
      watchlist,
      known_paused: knownPaused,
      stripe_unavailable: !!stripeUnavailable,
    },
    foundation: {
      one_time_this_month_cents: centsInt(foundation.one_time_this_month_cents),
      recurring_this_month_cents: centsInt(foundation.recurring_this_month_cents),
      ytd_cents: centsInt(foundation.ytd_cents),
      new_recurring: foundation.new_recurring,
      lapsed_recurring: foundation.lapsed_recurring,
      ppgf_this_month_cents: centsInt(foundation.ppgf_this_month_cents),
    },
    academy: {
      course_purchases_this_month: Math.round(academy.course_purchases_this_month) || 0,
      course_revenue_this_month_cents: centsInt(academy.course_revenue_this_month_cents),
      ytd_purchases: Math.round(academy.ytd_purchases) || 0,
      ytd_cents: centsInt(academy.ytd_cents),
    },
    actions,
    trend,
  };
}

/**
 * GET /api/admin/membership-report
 * Unified membership + supporter report for the admin dashboard (Naomi is the
 * primary human audience; the observatory cron is the machine caller).
 *
 * Auth is dual-path:
 *   - Machine: Authorization: Bearer ADMIN_API_SECRET (constant-time compare)
 *   - Human:   admin-or-higher session cookie (NOT superadmin)
 *
 * Point-in-time sections use Date.now() regardless of ?month. Stripe is a soft
 * dependency: if it is unreachable the report still returns 200 with D1-derived
 * data, headline.degraded=true, and the prior-month delta nulled. D1 failure is
 * a hard 500. Every response carries Cache-Control: no-store.
 *
 * PRIVACY: member names/emails never reach log()/Analytics Engine. Only counts
 * and status codes are logged.
 */
import Stripe from 'stripe';
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
  roleAtLeast, constantTimeEqual, STRIPE_API_VERSION,
} from '../auth/_shared.js';
import { log } from '../_log.js';
import { STUC_MEMBER_WHERE, tierFromPriceOrAmount, tierFromLabel } from '../community/_shared.js';
import {
  monthBoundsET, validateMonthParam, invoiceDropout, isDunningDropout,
  subStartEpochMs, computeLapsed, centsInt, assembleReport, KNOWN_PAUSED,
  LAPSE_MAX_DAYS, parseDbTs, anticipatedRenewalsCents,
} from './_membership-metrics.js';

const STUC_LABEL = 'Save the Uterus Club \u{1F3F7}\u{FE0F}';
const MAX_PAGES = 10;
const STRIPE_STATUSES = ['active', 'past_due', 'unpaid', 'canceled'];
const DAY_MS = 86_400_000;

// Every response from this endpoint -- success or error -- must carry
// Cache-Control: no-store (dashboard data must never be served stale from a
// shared/browser cache). Route every return through this local helper rather
// than calling json() directly.
function respond(data, status = 200) {
  return json(data, status, { 'Cache-Control': 'no-store' });
}

function normalizeTier(raw) {
  if (raw == null) return 'member';
  const s = String(raw).toLowerCase();
  if (s === 'member' || s === 'hero' || s === 'superhero') return s;
  return tierFromLabel(raw) || 'member';
}

async function requireAdminOrBearer(request, env) {
  const authz = request.headers.get('Authorization') || '';
  if (authz.startsWith('Bearer ')) {
    const token = authz.slice(7);
    if (env.ADMIN_API_SECRET && constantTimeEqual(token, env.ADMIN_API_SECRET)) {
      return { user: { role: 'admin', machine: true } };
    }
    return respond({ ok: false, error: 'Not authenticated' }, 401);
  }
  if (!env.DB) return respond({ ok: false, error: 'Server misconfigured' }, 500);
  const sessionId = getSessionIdFromCookie(request);
  const session = await validateSession(env.DB, sessionId);
  if (!session) return respond({ ok: false, error: 'Not authenticated' }, 401);
  if (!roleAtLeast(session.role, 'admin')) return respond({ ok: false, error: 'Forbidden' }, 403);
  return { user: { role: session.role, id: session.userId } };
}

async function runReads(db, stmts) {
  if (typeof db.batch === 'function') return db.batch(stmts);
  const out = [];
  for (const s of stmts) out.push(await s.all());
  return out;
}

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAdminOrBearer(request, env);
    if (auth instanceof Response) return auth;

    if (!env.DB) return respond({ ok: false, error: 'Database unavailable' }, 503);

    const url = new URL(request.url);
    const nowMs = Date.now();
    const month = validateMonthParam(url.searchParams.get('month'), nowMs);
    if (!month) {
      return respond({ ok: false, error: 'Invalid month. Use YYYY-MM within the last 24 months.' }, 400);
    }

    const b = monthBoundsET(month);
    const monthStartMs = Date.parse(b.startUtc);
    const monthEndMs = Date.parse(b.endUtc);

    const [ty, tm] = month.split('-').map(Number);
    let sy = ty, sm = tm - 11;
    while (sm < 1) { sm += 12; sy -= 1; }
    const trendStart = monthBoundsET(`${sy}-${String(sm).padStart(2, '0')}`).startUtc;
    const ytdStart = monthBoundsET(`${ty}-01`).startUtc;

    // --- D1 reads (hard dependency: any throw -> 500) --------------------
    let d1;
    try {
      const db = env.DB;
      const rosterStmt = db.prepare(`
        SELECT
          u.id, u.email, u.role,
          (CASE WHEN u.role IN ('mod','admin','superadmin') THEN 1 ELSE 0 END) AS is_staff,
          (SELECT 1 FROM user_label ul WHERE ul.user_id = u.id AND ul.label = 'STUC Legacy Grandfather') AS has_legacy,
          (CASE WHEN u.stripe_customer_id IS NOT NULL
                AND u.id IN (SELECT user_id FROM user_label WHERE label = '${STUC_LABEL}')
                THEN 1 ELSE 0 END) AS has_stripe,
          (SELECT 1 FROM wix_subscription ws
             WHERE (ws.user_id = u.id OR ws.email = u.email COLLATE NOCASE)
               AND ws.status = 'active'
               AND ws.migration_status NOT IN ('stripe_active','migrated','fully_exited')
               AND COALESCE(ws.next_expected_at, datetime(ws.last_order_at,'+31 days')) >= datetime('now','-7 days')
             LIMIT 1) AS has_wix,
          (SELECT tier FROM wix_subscription ws2
             WHERE (ws2.user_id = u.id OR ws2.email = u.email COLLATE NOCASE) AND ws2.status='active'
             ORDER BY ws2.last_order_at DESC LIMIT 1) AS wix_tier,
          (SELECT amount_cents FROM wix_subscription ws3
             WHERE (ws3.user_id = u.id OR ws3.email = u.email COLLATE NOCASE) AND ws3.status='active'
             ORDER BY ws3.last_order_at DESC LIMIT 1) AS wix_amount_cents
        FROM user u
        WHERE ${STUC_MEMBER_WHERE}
      `);

      const donorEmailsStmt = db.prepare(
        `SELECT DISTINCT lower(email) AS email FROM donor_gift
         WHERE refunded_at IS NULL AND occurred_at >= ?1 AND occurred_at < ?2`
      ).bind(b.startUtc, b.endUtc);

      const monthAggStmt = db.prepare(
        `SELECT
           SUM(CASE WHEN kind='one_time' AND entity='foundation' THEN amount_cents ELSE 0 END) AS f_one_time,
           SUM(CASE WHEN kind='recurring' AND entity='foundation' THEN amount_cents ELSE 0 END) AS f_recurring,
           SUM(CASE WHEN ppgf=1 THEN amount_cents ELSE 0 END) AS ppgf,
           SUM(CASE WHEN kind='course' THEN amount_cents ELSE 0 END) AS academy_cents,
           SUM(CASE WHEN kind='course' THEN 1 ELSE 0 END) AS academy_purchases
         FROM donor_gift
         WHERE refunded_at IS NULL AND occurred_at >= ?1 AND occurred_at < ?2`
      ).bind(b.startUtc, b.endUtc);

      const ytdAggStmt = db.prepare(
        `SELECT
           SUM(CASE WHEN kind='one_time' AND entity='foundation' THEN amount_cents ELSE 0 END) AS f_one_time,
           SUM(CASE WHEN kind='recurring' AND entity='foundation' THEN amount_cents ELSE 0 END) AS f_recurring,
           SUM(CASE WHEN kind='course' THEN amount_cents ELSE 0 END) AS academy_cents,
           SUM(CASE WHEN kind='course' THEN 1 ELSE 0 END) AS academy_purchases
         FROM donor_gift
         WHERE refunded_at IS NULL AND occurred_at >= ?1 AND occurred_at < ?2`
      ).bind(ytdStart, b.endUtc);

      const priorAggStmt = db.prepare(
        `SELECT SUM(CASE WHEN kind='membership' THEN amount_cents ELSE 0 END) AS stuc_cents
         FROM donor_gift
         WHERE refunded_at IS NULL AND occurred_at >= ?1 AND occurred_at < ?2`
      ).bind(b.prevStartUtc, b.prevEndUtc);

      // wix_subscription started_at/updated_at have no canonical storage format
      // (populated by the external Wix sync), so normalize both sides via
      // datetime() to compare correctly regardless of stored shape. Mirrors the
      // datetime() normalization STUC_MEMBER_WHERE applies to last_order_at.
      const wixJoinedStmt = db.prepare(
        `SELECT email FROM wix_subscription
         WHERE status='active'
           AND datetime(started_at) >= datetime(?1) AND datetime(started_at) < datetime(?2)`
      ).bind(b.startUtc, b.endUtc);

      const wixLeftStmt = db.prepare(
        `SELECT email FROM wix_subscription
         WHERE status IN ('canceled','cancelled','expired')
           AND datetime(updated_at) >= datetime(?1) AND datetime(updated_at) < datetime(?2)`
      ).bind(b.startUtc, b.endUtc);

      const lapseStmt = db.prepare(
        `SELECT u.email AS email, u.created_at AS created_at, MAX(g.occurred_at) AS last_gift_at
         FROM user u
         LEFT JOIN donor_gift g ON g.email = u.email COLLATE NOCASE
           AND g.source='stripe' AND g.kind='membership' AND g.refunded_at IS NULL
         WHERE u.blocked = 0 AND u.stripe_customer_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM user_label ul WHERE ul.user_id = u.id AND ul.label = '${STUC_LABEL}')
         GROUP BY u.id, u.email, u.created_at`
      );

      // New foundation recurring donors: their FIRST-ever qualifying recurring
      // gift falls inside the reporting month. LIMIT 50 per spec.
      const newRecurringStmt = db.prepare(
        `SELECT lower(email) AS email,
           (SELECT display_name FROM donor_gift d2
              WHERE d2.email = d.email COLLATE NOCASE AND d2.kind='recurring' AND d2.entity='foundation' AND d2.refunded_at IS NULL
              ORDER BY d2.occurred_at ASC LIMIT 1) AS display_name,
           (SELECT amount_cents FROM donor_gift d3
              WHERE d3.email = d.email COLLATE NOCASE AND d3.kind='recurring' AND d3.entity='foundation' AND d3.refunded_at IS NULL
              ORDER BY d3.occurred_at ASC LIMIT 1) AS amount_cents
         FROM donor_gift d
         WHERE d.kind='recurring' AND d.entity='foundation' AND d.refunded_at IS NULL
         GROUP BY lower(d.email)
         HAVING MIN(d.occurred_at) >= ?1 AND MIN(d.occurred_at) < ?2
         LIMIT 50`
      ).bind(b.startUtc, b.endUtc);

      // Lapsed foundation recurring donors: at least one qualifying recurring
      // gift, most recent older than LAPSE_MAX_DAYS as of month end (computed
      // in JS below -- same 45-day threshold constant as the STUC lapse scan,
      // ported from rrm-observatory stuc-label-drift.js). Ordered oldest-last-
      // gift-first so the LIMIT 50 keeps the most urgent candidates.
      const lapsedRecurringStmt = db.prepare(
        `SELECT lower(email) AS email,
           (SELECT display_name FROM donor_gift d2
              WHERE d2.email = d.email COLLATE NOCASE AND d2.kind='recurring' AND d2.entity='foundation' AND d2.refunded_at IS NULL
              ORDER BY d2.occurred_at DESC LIMIT 1) AS display_name,
           MAX(d.occurred_at) AS last_gift_at
         FROM donor_gift d
         WHERE d.kind='recurring' AND d.entity='foundation' AND d.refunded_at IS NULL
         GROUP BY lower(d.email)
         ORDER BY last_gift_at ASC
         LIMIT 50`
      );

      // MoM supporters over the two calendar months in one grouped query.
      // Distinct lowercase givers with any non-refunded donor_gift activity;
      // bucketed at the ET month boundary (startUtc) so both sides use the same
      // ET bounds as the rest of the report.
      const momSupportersStmt = db.prepare(
        `SELECT DISTINCT lower(email) AS email,
           CASE WHEN occurred_at >= ?2 THEN 'this' ELSE 'prior' END AS bucket
         FROM donor_gift
         WHERE refunded_at IS NULL AND occurred_at >= ?1 AND occurred_at < ?3`
      ).bind(b.prevStartUtc, b.startUtc, b.endUtc);

      // Anticipation candidates (r4 addendum): active MONTH-frequency Wix subs.
      // The renewal window is filtered in JS (anticipatedRenewalsCents) so the
      // logic stays pure and unit-testable; this query only narrows to the
      // month-frequency active set and surfaces the next-renewal timestamp.
      const wixAnticipateStmt = db.prepare(
        `SELECT email, amount_cents,
           COALESCE(next_expected_at, datetime(last_order_at,'+31 days')) AS next_renewal
         FROM wix_subscription
         WHERE status='active' AND frequency='MONTH'`
      );

      const trendStmt = db.prepare(
        `SELECT strftime('%Y-%m', occurred_at) AS ym,
           SUM(CASE WHEN kind='membership' THEN amount_cents ELSE 0 END) AS stuc_cents,
           SUM(CASE WHEN kind IN ('one_time','recurring') AND entity='foundation' THEN amount_cents ELSE 0 END) AS foundation_cents,
           SUM(CASE WHEN kind='course' THEN amount_cents ELSE 0 END) AS academy_cents
         FROM donor_gift
         WHERE refunded_at IS NULL AND occurred_at >= ?1
         GROUP BY ym ORDER BY ym`
      ).bind(trendStart);

      const res = await runReads(db, [
        rosterStmt, donorEmailsStmt, monthAggStmt, ytdAggStmt, priorAggStmt,
        wixJoinedStmt, wixLeftStmt, lapseStmt, newRecurringStmt, lapsedRecurringStmt, trendStmt,
        momSupportersStmt, wixAnticipateStmt,
      ]);
      d1 = {
        roster: res[0]?.results || [],
        donorEmails: res[1]?.results || [],
        monthAgg: res[2]?.results?.[0] || {},
        ytdAgg: res[3]?.results?.[0] || {},
        priorAgg: res[4]?.results?.[0] || {},
        wixJoined: res[5]?.results || [],
        wixLeft: res[6]?.results || [],
        lapse: res[7]?.results || [],
        newRecurringRaw: res[8]?.results || [],
        lapsedRecurringRaw: res[9]?.results || [],
        trend: res[10]?.results || [],
        momSupporters: res[11]?.results || [],
        wixAnticipate: res[12]?.results || [],
      };
    } catch (err) {
      log(env, null, 'admin', 'membership_report_d1_error', 'error', err.message, 0, 500);
      return respond({ ok: false, error: 'Database error' }, 500);
    }

    const rosterRows = d1.roster.map((row) => {
      const is_staff = !!row.is_staff;
      return {
        email: row.email,
        emailLower: String(row.email || '').toLowerCase(),
        role: row.role,
        has_stripe: !!row.has_stripe && !is_staff,
        has_legacy: !!row.has_legacy && !is_staff,
        has_wix: !!row.has_wix,
        tier: normalizeTier(row.wix_tier),
        monthly_cents: row.wix_amount_cents || 0,
        wix_amount_cents: row.wix_amount_cents || 0,
        wix_tier: row.wix_tier,
      };
    });

    // --- Stripe (soft dependency: failure -> degraded, never a 500) ------
    let stripeUnavailable = false;
    let stripeTruncated = false;
    const subStartByEmail = new Map();
    const stripeByEmail = new Map();
    const stripeJoins = [];
    const stripeLeaves = [];
    const stripeWatch = [];
    const stripeAnticipate = [];
    const pausedSet = new Set(KNOWN_PAUSED.map((e) => e.email.toLowerCase()));

    if (!env.STRIPE_RESTRICTED_KEY) {
      stripeUnavailable = true;
    } else {
      try {
        const stripe = new Stripe(env.STRIPE_RESTRICTED_KEY, {
          httpClient: Stripe.createFetchHttpClient(),
          apiVersion: STRIPE_API_VERSION,
        });
        for (const status of STRIPE_STATUSES) {
          let count = 0;
          for await (const sub of stripe.subscriptions.list({
            status, limit: 100, expand: ['data.customer', 'data.latest_invoice'],
          })) {
            count++;
            if (count > MAX_PAGES * 100) { stripeTruncated = true; break; }

            const cust = sub.customer && typeof sub.customer === 'object' ? sub.customer : null;
            const email = cust?.email ? String(cust.email).toLowerCase() : null;
            const isPaused = email ? pausedSet.has(email) : false;
            const voided = invoiceDropout(sub);

            if (email && !voided) {
              const startMs = subStartEpochMs(sub);
              if (Number.isFinite(startMs)) {
                const prevMs = subStartByEmail.get(email);
                if (prevMs == null || startMs > prevMs) subStartByEmail.set(email, startMs);
              }
            }

            if (status === 'active' && email) {
              const item = sub.items?.data?.[0];
              let amount = item?.price?.unit_amount;
              if (typeof amount === 'number') {
                if (item.price.recurring?.interval === 'year') amount = Math.round(amount / 12);
              } else {
                amount = 0;
              }
              stripeByEmail.set(email, { amount_cents: amount, tier: tierFromPriceOrAmount(sub, env) });

              // Anticipation candidate: active, not paused, not a voided-invoice
              // dropout. Its next renewal (current_period_end) is window-checked
              // in anticipatedRenewalsCents. Watchlist/dunning exclusion is
              // applied via excludeAnticip below.
              if (!isPaused && !voided) {
                const renewalMs = Number.isFinite(sub.current_period_end)
                  ? sub.current_period_end * 1000 : NaN;
                stripeAnticipate.push({ email, amount_cents: amount, next_renewal_ms: renewalMs, source: 'stripe' });
              }
            }

            if (!isPaused) {
              if (voided) {
                stripeWatch.push({
                  kind: 'voided_invoice', email, name: cust?.name || null,
                  action: 'Their most recent payment was voided but the subscription is still open. Cancel it in Stripe.',
                });
              } else if (isDunningDropout(sub)) {
                stripeWatch.push({
                  kind: 'past_due', email, name: cust?.name || null,
                  action: 'Their card is failing. Recover the payment or cancel in Stripe.',
                });
              }
            }

            const joinMs = subStartEpochMs(sub);
            if (Number.isFinite(joinMs) && joinMs >= monthStartMs && joinMs < monthEndMs) {
              stripeJoins.push({ email, name: cust?.name || null });
            }
            if (Number.isFinite(sub.canceled_at)) {
              const cMs = sub.canceled_at * 1000;
              if (cMs >= monthStartMs && cMs < monthEndMs) stripeLeaves.push({ email, name: cust?.name || null });
            }
          }
        }
      } catch (err) {
        stripeUnavailable = true;
        log(env, null, 'admin', 'membership_report_stripe_unavailable', 'warn', err.message, 0, 200);
      }
    }

    // Fold Stripe amounts/tiers into the paying stripe-branch roster rows.
    if (!stripeUnavailable) {
      for (const r of rosterRows) {
        if (!r.has_stripe) continue;
        const s = stripeByEmail.get(r.emailLower);
        if (s) {
          r.monthly_cents = s.amount_cents;
          r.tier = s.tier;
        } else {
          r.monthly_cents = r.wix_amount_cents || 0;
          r.tier = normalizeTier(r.wix_tier);
        }
      }
    }

    // total_supporters union leg: paying roster emails (staff/legacy already
    // excluded from has_stripe/has_wix) + non-refunded donor_gift givers this
    // month (which already includes course buyers, kind='course').
    const supporterEmails = [];
    for (const r of rosterRows) {
      if (r.has_stripe || r.has_wix) supporterEmails.push(r.email);
    }
    for (const row of d1.donorEmails) supporterEmails.push(row.email);

    // --- lapse watchlist (created_at grace fallback when Stripe is down) --
    const lapseFlagged = computeLapsed({ giftRows: d1.lapse, subStartByEmail, nowMs });
    const lapseWatch = lapseFlagged
      .filter((f) => !pausedSet.has(String(f.email || '').toLowerCase()))
      .map((f) => ({
        kind: 'lapsed_payment', email: f.email, days: f.days,
        action: 'No membership payment in over 45 days. Confirm in Stripe, then remove them or mark paused.',
      }));

    const watchlist = [...stripeWatch, ...lapseWatch];

    // --- known paused (never a dropout) ---------------------------------
    const presentEmails = new Set([
      ...rosterRows.map((r) => r.emailLower),
      ...d1.lapse.map((r) => String(r.email || '').toLowerCase()),
    ]);
    const knownPaused = [];
    for (const e of KNOWN_PAUSED) {
      if (presentEmails.has(e.email.toLowerCase())) {
        knownPaused.push({ name: e.name, note: e.note });
      }
    }

    const joined = [...d1.wixJoined.map((r) => ({ email: r.email, name: null })), ...stripeJoins];
    const left = [...d1.wixLeft.map((r) => ({ email: r.email, name: null })), ...stripeLeaves];

    const newRecurring = d1.newRecurringRaw.map((r) => ({
      email: r.email,
      display_name: r.display_name || null,
      amount_cents: centsInt(r.amount_cents),
    }));

    // days_since_last is computed as of the reporting month's end (not
    // Date.now()), per spec -- the report is describing the state of that
    // month, not the state right now.
    const lapsedRecurring = d1.lapsedRecurringRaw
      .map((r) => {
        const lastMs = Date.parse(r.last_gift_at);
        const days = Number.isFinite(lastMs) ? Math.floor((monthEndMs - lastMs) / DAY_MS) : null;
        return { email: r.email, display_name: r.display_name || null, days_since_last: days };
      })
      .filter((r) => r.days_since_last != null && r.days_since_last > LAPSE_MAX_DAYS)
      .slice(0, 50);

    const foundation = {
      one_time_this_month_cents: d1.monthAgg.f_one_time || 0,
      recurring_this_month_cents: d1.monthAgg.f_recurring || 0,
      ytd_cents: (d1.ytdAgg.f_one_time || 0) + (d1.ytdAgg.f_recurring || 0),
      new_recurring: newRecurring,
      lapsed_recurring: lapsedRecurring,
      ppgf_this_month_cents: d1.monthAgg.ppgf || 0,
    };
    const academy = {
      course_purchases_this_month: d1.monthAgg.academy_purchases || 0,
      course_revenue_this_month_cents: d1.monthAgg.academy_cents || 0,
      ytd_purchases: d1.ytdAgg.academy_purchases || 0,
      ytd_cents: d1.ytdAgg.academy_cents || 0,
    };
    const trend = d1.trend.map((r) => ({
      month: r.ym,
      stuc_cents: centsInt(r.stuc_cents),
      foundation_cents: centsInt(r.foundation_cents),
      academy_cents: centsInt(r.academy_cents),
    }));

    // --- month-over-month (r4): like-for-like receipts + supporters ------
    const currentMonth = validateMonthParam(null, nowMs);
    const monthInProgress = month === currentMonth;

    // Prior calendar month as 'YYYY-MM'.
    const [my, mm] = month.split('-').map(Number);
    const pMonthNum = mm === 1 ? 12 : mm - 1;
    const pMonthYear = mm === 1 ? my - 1 : my;
    const priorMonthStr = `${pMonthYear}-${String(pMonthNum).padStart(2, '0')}`;

    // Receipts reuse the same donor_gift membership series the trend already
    // bucketed, so both months are the same quantity. The trend buckets by
    // strftime UTC month while the rest of the report uses ET month bounds;
    // that UTC-vs-ET edge slop is the known, accepted difference (see
    // monthBoundsET) and is reused deliberately so both surfaces read one series.
    const trendStucByYm = new Map(trend.map((t) => [t.month, t.stuc_cents]));
    const receiptsThisCents = centsInt(trendStucByYm.get(month) || 0);
    const receiptsPriorCents = centsInt(trendStucByYm.get(priorMonthStr) || 0);

    const momThis = new Set();
    const momPrior = new Set();
    for (const r of d1.momSupporters) {
      const e = String(r.email || '').toLowerCase();
      if (!e) continue;
      if (r.bucket === 'this') momThis.add(e); else momPrior.add(e);
    }
    // Current month: paying roster members are supporters even before their
    // gift lands in donor_gift, so union them in. A past month must use its own
    // snapshot (the roster is as-of now, not as-of then), so only union live.
    if (monthInProgress) {
      for (const r of rosterRows) {
        if (r.has_stripe || r.has_wix) momThis.add(r.emailLower);
      }
    }

    // Anticipated (date-aware) current-month revenue: collected so far plus the
    // scheduled renewals still to land this month. Never anticipate money from
    // anyone on the watchlist (voided/dunning) or paused. Null for completed
    // months (no remaining window).
    let receiptsAnticipatedCents = null;
    if (monthInProgress) {
      const excludeAnticip = new Set([
        ...pausedSet,
        ...watchlist.map((w) => String(w.email || '').toLowerCase()),
      ]);
      const wixAnticipate = (d1.wixAnticipate || []).map((r) => ({
        email: r.email,
        amount_cents: r.amount_cents,
        next_renewal_ms: parseDbTs(r.next_renewal),
        source: 'wix',
      }));
      const extra = anticipatedRenewalsCents({
        candidates: [...wixAnticipate, ...stripeAnticipate],
        nowMs,
        monthEndMs,
        excludeEmails: excludeAnticip,
      });
      receiptsAnticipatedCents = receiptsThisCents + extra;
    }

    const mom = {
      receipts_this_month_cents: receiptsThisCents,
      receipts_prior_month_cents: receiptsPriorCents,
      receipts_anticipated_cents: receiptsAnticipatedCents,
      supporters_this_month: momThis.size,
      supporters_prior_month: momPrior.size,
      month_in_progress: monthInProgress,
    };

    // --- actions (who inferred: dropout/lapse -> Brian, reach out -> Naomi) ---
    const actions = [];
    for (const w of watchlist) actions.push({ who: 'Brian', what: w.action });
    if (stripeTruncated) actions.push({ who: 'Brian', what: 'Stripe list truncated, report may be partial.' });
    for (const donor of foundation.lapsed_recurring) {
      actions.push({ who: 'Naomi', what: `Reach out to ${donor.display_name || donor.email}, a lapsed recurring donor.` });
    }

    const report = assembleReport({
      generatedAt: new Date(nowMs).toISOString(),
      month,
      rosterRows,
      priorRecurringCents: d1.priorAgg.stuc_cents || 0,
      supporterEmails,
      joined,
      left,
      watchlist,
      knownPaused,
      foundation,
      academy,
      actions,
      trend,
      mom,
      stripeUnavailable,
    });

    log(env, null, 'admin', 'membership_report_ok', 'ok', month, 0, 200,
      [String(rosterRows.length), stripeUnavailable ? 'degraded' : 'full']);

    return respond(report, 200);
  } catch (err) {
    log(env, null, 'admin', 'membership_report_error', 'error', err.message, 0, 502);
    return respond({ ok: false, error: 'Failed to build membership report' }, 502);
  }
}

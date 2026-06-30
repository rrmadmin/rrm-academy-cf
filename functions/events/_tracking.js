/**
 * Client-side tracking snippets for the public event landing page
 * (functions/events/[slug].js). That page is server-rendered as a raw HTML
 * string WITHOUT BaseLayout, so it does NOT inherit the site-wide
 * instrumentation. These snippets restore it.
 *
 * They MIRROR, and must be kept in sync with:
 *   - src/layouts/BaseLayout.astro  -> fingerprint /identify + Microsoft Clarity
 *   - src/scripts/ga-session.ts + src/scripts/track.ts -> first-party GA4 beacon
 *
 * Identity keys are identical (rrm_vid, rrm_ga_cid, rrm_ga_ses) so an event-page
 * hit stitches to the same visitor/session as the rest of the site in both GA4
 * and the fingerprint worker.
 *
 * Privacy parity with BaseLayout: fingerprint + Clarity skip on GPC; GA4 skips
 * on DNT. No backticks / no ${} inside the script bodies below -- they live
 * inside the event page's own template literal once interpolated.
 *
 * The leading underscore keeps CF Pages from treating this as a route handler.
 */

// Goes in <head>: preconnect to the fingerprint worker origin.
export const TRACKING_HEAD =
  '<link rel="preconnect" href="https://fp.rrmacademy.org" crossorigin>\n' +
  '<link rel="dns-prefetch" href="https://fp.rrmacademy.org">';

// Goes just before </body>: fingerprint identify + GA4 page_view + Clarity.
export const TRACKING_BODY = `
<!-- Fingerprint/visitor-ID (mirrors BaseLayout.astro). GPC-respecting. -->
<script>
(function () {
  if (navigator.globalPrivacyControl === true) return;
  var inFlight = Number(sessionStorage.getItem('fp_in_flight'));
  if (inFlight && Date.now() - inFlight < 10000) return;
  sessionStorage.setItem('fp_in_flight', String(Date.now()));
  var fpHost = location.hostname.endsWith('rrm.foundation') ? 'fp.rrm.foundation' : 'fp.rrmacademy.org';
  var fire = function () {
    var params = new URLSearchParams(location.search);
    var utm = {
      source: params.get('utm_source') || undefined,
      medium: params.get('utm_medium') || undefined,
      campaign: params.get('utm_campaign') || undefined
    };
    var vid_hint = localStorage.getItem('rrm_vid') || undefined;
    fetch('https://' + fpHost + '/identify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: location.pathname, referrer: document.referrer || null, utm: utm, vid_hint: vid_hint })
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (data) {
      if (data && data.clear_storage) { localStorage.removeItem('rrm_vid'); }
      else if (data && data.visitor_id) { localStorage.setItem('rrm_vid', data.visitor_id); }
    }).catch(function () {}).then(function () {
      sessionStorage.removeItem('fp_in_flight');
    });
  };
  if ('requestIdleCallback' in window) {
    var fired = false;
    var fireOnce = function () { if (!fired) { fired = true; fire(); } };
    requestIdleCallback(fireOnce);
    setTimeout(fireOnce, 2000);
  } else {
    setTimeout(fire, 0);
  }
})();
</script>

<!-- First-party GA4 page_view via /api/track (mirrors ga-session.ts + track.ts). Honors DNT. -->
<script>
(function () {
  try {
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
    var CID_KEY = 'rrm_ga_cid', SES_KEY = 'rrm_ga_ses', TIMEOUT_MS = 1800000;
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function uuid() {
      try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }
    var now = Date.now();
    var cid = lsGet(CID_KEY);
    if (!cid || !UUID_RE.test(cid)) { cid = uuid(); lsSet(CID_KEY, cid); }
    var sid = 0, sn = 0, last = 0, raw = lsGet(SES_KEY);
    if (raw) { try { var o = JSON.parse(raw); sid = Number(o.sid) || 0; sn = Number(o.sn) || 0; last = Number(o.last) || 0; } catch (e) {} }
    if (!sid || now - last > TIMEOUT_MS) { sid = Math.floor(now / 1000); sn = sn + 1; }
    lsSet(SES_KEY, JSON.stringify({ sid: sid, sn: sn, last: now }));
    var payload = JSON.stringify({
      event: 'page_view',
      params: { page_location: location.href, page_referrer: document.referrer || '', engagement_time_msec: 1 },
      cid: cid, sid: sid, sn: sn
    });
    try {
      var blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon && navigator.sendBeacon('/api/track', blob)) return;
    } catch (e) {}
    fetch('/api/track', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
  } catch (e) {}
})();
</script>

<!-- Microsoft Clarity (mirrors BaseLayout.astro). GPC + dev-host excluded. -->
<script>
(function () {
  if (navigator.globalPrivacyControl === true) return;
  var h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.pages.dev')) return;
  function startClarity() {
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i + '?ref=bwt';
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', 'xcwba0naze');
  }
  if ('requestIdleCallback' in window) { requestIdleCallback(startClarity, { timeout: 4000 }); }
  else if (document.readyState === 'complete') { startClarity(); }
  else { window.addEventListener('load', startClarity, { once: true }); }
})();
</script>`;

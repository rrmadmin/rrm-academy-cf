/**
 * EVERY EXTERNAL SERVICE THE TARGETED ROUTES TALK TO, REPLACED BY A COUNTER.
 *
 * The cost family's whole claim is "a refused request costs nothing", and
 * that is a claim about CALLS, not about responses. So this router's real
 * product is `counts`: one integer per upstream, incremented before any
 * response is shaped. A route that reaches Stripe and then discards the
 * answer still spent the call, and this fake is the only thing that can say
 * so.
 *
 * DEFAULTS ARE THE PERMISSIVE ANSWER, deliberately. Turnstile says the token
 * is good, SES accepts the send, DNS finds an MX, ELV says the mailbox is
 * fine. A refusal that only happens because the fake said no proves nothing
 * about the gate under test; making every upstream say YES means a case that
 * still gets refused was refused by the code.
 *
 * AN UNROUTED HOST THROWS. A route that grows a new upstream dependency
 * fails this harness loudly rather than silently reaching the real internet
 * from a test process.
 */

const OK_JSON = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_redteam' } });

export function installUpstream({ turnstile = true, stripeRoutes = {} } = {}) {
  const original = globalThis.fetch;
  const counts = { ses: 0, stripe: 0, ga4: 0, turnstile: 0, dns: 0, elv: 0, ads: 0, arrivl: 0, other: 0 };
  const calls = [];

  globalThis.fetch = async (input, init) => {
    const url = (input && typeof input === 'object' && input.url) ? input.url : String(input);
    const record = { url, service: 'other' };
    calls.push(record);

    if (url.includes('amazonaws.com')) {
      record.service = 'ses';
      counts.ses += 1;
      /* aws4fetch hands the stub a signed Request, so the body is on the
         Request itself; the mail family reads it to assert who was mailed. */
      try { record.body = input && typeof input.text === 'function' ? await input.clone().text() : init?.body ?? null; }
      catch { record.body = null; }
      return OK_JSON({ MessageId: 'redteam-ses-message-id' });
    }
    if (url.includes('api.stripe.com')) {
      record.service = 'stripe';
      counts.stripe += 1;
      const path = new URL(url).pathname;
      for (const [needle, value] of Object.entries(stripeRoutes)) {
        if (path.includes(needle)) return value instanceof Response ? value : OK_JSON(typeof value === 'function' ? value(record) : value);
      }
      return OK_JSON({ error: { type: 'invalid_request_error', code: 'resource_missing', message: 'redteam: no stripe route' } }, 404);
    }
    if (url.includes('google-analytics.com')) {
      record.service = 'ga4';
      counts.ga4 += 1;
      return new Response('', { status: 204 });
    }
    if (url.includes('siteverify')) {
      record.service = 'turnstile';
      counts.turnstile += 1;
      return OK_JSON({ success: turnstile, 'error-codes': turnstile ? [] : ['invalid-input-response'] });
    }
    if (url.includes('cloudflare-dns.com')) {
      record.service = 'dns';
      counts.dns += 1;
      return OK_JSON({ Answer: [{ data: 'mx.redteam.example' }] });
    }
    if (url.includes('emaillistverify.com')) {
      record.service = 'elv';
      counts.elv += 1;
      return new Response('ok', { status: 200 });
    }
    if (url.includes('googleapis.com') || url.includes('googleads.googleapis.com') || url.includes('oauth2.googleapis.com')) {
      record.service = 'ads';
      counts.ads += 1;
      return OK_JSON({ access_token: 'redteam-ads-access-token', expires_in: 3600, results: [] });
    }
    if (url.includes('arrivl.ai')) {
      record.service = 'arrivl';
      counts.arrivl += 1;
      return OK_JSON({ ok: true });
    }

    counts.other += 1;
    throw new Error(`redteam upstream: unrouted request to ${url}`);
  };

  return {
    counts,
    calls,
    /** The bodies SES was handed, so a case can assert who was NOT mailed. */
    get mail() { return calls.filter((c) => c.service === 'ses'); },
    restore() { globalThis.fetch = original; },
  };
}

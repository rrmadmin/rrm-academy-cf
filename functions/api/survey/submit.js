/**
 * POST /api/survey/submit
 * Stores survey results in Airtable and consumes the token.
 * Input: { token, symptoms: { tier1: [...], tier2: [...], tier3: [...] }, score: { tier1, tier2, tier3, total } }
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://rrmacademy.org',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SURVEY_TOKENS) {
    return json({ ok: false, error: 'Server misconfigured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const { token, symptoms, score } = body;
  if (!token || !symptoms || !score) {
    return json({ ok: false, error: 'Missing required fields' }, 400);
  }

  // Validate token
  const data = await env.SURVEY_TOKENS.get(`token:${token}`, 'json');
  if (!data) {
    return json({ ok: false, error: 'Token not found' }, 404);
  }
  if (data.used) {
    return json({ ok: false, error: 'Survey already completed' }, 409);
  }

  // Mark token as used
  const updated = { ...data, used: true, completedAt: Date.now() };
  await env.SURVEY_TOKENS.put(`token:${token}`, JSON.stringify(updated), {
    expirationTtl: 90 * 24 * 60 * 60,
  });

  // Store in Airtable
  if (env.AIRTABLE_PAT && env.AIRTABLE_SURVEY_BASE && env.AIRTABLE_SURVEY_TABLE) {
    try {
      const referrer = request.headers.get('referer') || '';
      const fields = {
        Email: data.email,
        Score: score.total,
        'Tier 1 Count': score.tier1,
        'Tier 2 Count': score.tier2,
        'Tier 3 Count': score.tier3,
        'Tier 1 Symptoms': (symptoms.tier1 || []).join('\n'),
        'Tier 2 Symptoms': (symptoms.tier2 || []).join('\n'),
        'Tier 3 Symptoms': (symptoms.tier3 || []).join('\n'),
        Submitted: new Date().toISOString(),
        Source: referrer,
        'User Origin': data.userorigin || '',
      };

      await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_SURVEY_BASE}/${env.AIRTABLE_SURVEY_TABLE}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.AIRTABLE_PAT}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ records: [{ fields }], typecast: true }),
        }
      );
    } catch (err) {
      // Log but don't fail the user — token is already consumed
      console.error('Airtable write failed:', err.message);
    }
  }

  return json({ ok: true });
}

import { sendEmail, logEmailFailure } from '../_ses.js';
import { log } from '../_log.js';
import { validateEmail } from '../auth/_email-validate.js';
import { verifyAndTagEmail } from '../_elv.js';
import { json, optionsResponse, checkRateLimit, verifyTurnstile } from '../auth/_shared.js';

const METHOD_KEYS = new Set([
  'sdm', 'twoday', 'billings', 'creighton', 'femm', 'sensiplan', 'marquette',
]);

const ALLOWED_ANSWER_KEYS = new Set([
  'goal', 'cycles', 'postpartum', 'offbc', 'effort', 'femtech', 'device', 'budget', 'clinical',
]);

const MAX_ANSWER_VALUE_LEN = 40;
const MAX_ANSWER_ENTRIES = 12;

const METHOD_EMAIL = {
  sdm: {
    name: 'Standard Days Method',
    tagline: 'a simple calendar method for predictable cycles',
    url: 'https://irh.org/',
    label: 'Georgetown Institute for Reproductive Health',
  },
  twoday: {
    name: 'TwoDay Method',
    tagline: 'a simple daily check of cervical secretions',
    url: 'https://irh.org/',
    label: 'Georgetown Institute for Reproductive Health',
  },
  billings: {
    name: 'Billings Ovulation Method',
    tagline: 'a device-free method that reads cervical mucus',
    url: 'https://www.woomb.org/',
    label: 'WOOMB International',
  },
  creighton: {
    name: 'Creighton Model FertilityCare System',
    tagline: 'a standardized mucus chart used in NaProTechnology',
    url: 'https://www.fertilitycare.org/',
    label: 'FertilityCare Centers of America',
  },
  femm: {
    name: 'FEMM',
    tagline: 'a cervical-mucus method with optional hormone tracking and a medical-management focus',
    url: 'https://femmhealth.org/',
    label: 'FEMM Health',
  },
  sensiplan: {
    name: 'Sympto-Thermal Method (Sensiplan)',
    tagline: 'cervical mucus plus waking temperature',
    url: 'https://ccli.org/',
    label: 'Couple to Couple League',
  },
  marquette: {
    name: 'Marquette Model',
    tagline: 'an electronic monitor that reads your hormones',
    url: 'https://www.marquette.edu/natural-family-planning/',
    label: 'Marquette University Institute for NFP',
  },
};

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  try {
    if (!env.SURVEY_DB) {
      return json({ error: 'service_unavailable' }, 503);
    }

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (!await checkRateLimit(env, `quiz:${ip}`, 5, 900)) {
      return json({ error: 'rate_limited' }, 429);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return json({ error: 'invalid_payload' }, 400);
    }

    const { email: rawEmail, primary, alternate, answers, researchConsent, turnstileToken } = body;

    // Turnstile
    if (!env.CF_TURNSTILE_SECRET) {
      return json({ error: 'service_unavailable' }, 503);
    }
    const turnstileResult = await verifyTurnstile(env.CF_TURNSTILE_SECRET, turnstileToken, ip, env);
    if (!turnstileResult.ok) {
      const msg = turnstileResult.reason === 'network'
        ? 'Verification service unavailable. Please try again in a moment.'
        : 'Spam check failed. Please refresh and try again.';
      return json({ error: msg }, 403);
    }

    // Email validation
    const emailCheck = await validateEmail(rawEmail, env);
    if (!emailCheck.valid) {
      return json({ error: emailCheck.error, ...(emailCheck.suggestion ? { suggestion: emailCheck.suggestion } : {}) }, 400);
    }
    const email = emailCheck.email;

    // Validate primary method
    if (typeof primary !== 'string' || !METHOD_KEYS.has(primary)) {
      return json({ error: 'invalid_primary_method' }, 400);
    }

    // Validate alternate method (optional)
    if (alternate !== undefined && alternate !== null && alternate !== '') {
      if (typeof alternate !== 'string' || !METHOD_KEYS.has(alternate)) {
        return json({ error: 'invalid_alternate_method' }, 400);
      }
    }
    const alternateMethod = (typeof alternate === 'string' && METHOD_KEYS.has(alternate) && alternate !== primary) ? alternate : null;

    // Validate and sanitize answers
    if (answers !== undefined && answers !== null) {
      if (typeof answers !== 'object' || Array.isArray(answers)) {
        return json({ error: 'invalid_answers' }, 400);
      }
    }
    const sanitizedAnswers = {};
    if (answers && typeof answers === 'object' && !Array.isArray(answers)) {
      const entries = Object.entries(answers);
      if (entries.length > MAX_ANSWER_ENTRIES) {
        return json({ error: 'too_many_answer_entries' }, 400);
      }
      for (const [k, v] of entries) {
        if (!ALLOWED_ANSWER_KEYS.has(k)) continue;
        if (typeof v !== 'string') {
          return json({ error: 'invalid_answer_value' }, 400);
        }
        if (v.length > MAX_ANSWER_VALUE_LEN) {
          return json({ error: 'answer_value_too_long' }, 400);
        }
        sanitizedAnswers[k] = v;
      }
    }

    const researchConsentInt = (researchConsent === true || researchConsent === 1) ? 1 : 0;
    if (researchConsentInt !== 1) {
      return json({ error: 'consent_required' }, 400);
    }

    // ELV (non-blocking)
    waitUntil(
      verifyAndTagEmail(email, env, { source: 'fabm-quiz' }).catch(() => {})
    );

    // Insert quiz result
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    try {
      await env.SURVEY_DB.prepare(
        'INSERT INTO quiz_result (id, email, primary_method, alternate_method, answers, research_consent, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        id,
        email,
        primary,
        alternateMethod,
        JSON.stringify(sanitizedAnswers),
        researchConsentInt,
        'fabm-quiz',
        createdAt,
      ).run();
    } catch (err) {
      console.error('quiz_result insert failed:', err.message);
      log(env, waitUntil, 'quiz', 'db_insert_error', 'error', 'insert failed', 0, 500);
      return json({ error: 'server_error' }, 500);
    }

    // Email (best-effort)
    const methodInfo = METHOD_EMAIL[primary];
    const alternateInfo = alternateMethod ? METHOD_EMAIL[alternateMethod] : null;
    if (methodInfo) {
      const emailSubject = `Your fertility awareness method match: ${methodInfo.name}`;
      const emailText = buildEmailText(methodInfo, alternateInfo);
      try {
        await sendEmail(env, {
          from: 'RRM Academy <info@mail.rrmacademy.org>',
          to: email,
          subject: emailSubject,
          text: emailText,
          log: { db: env.SURVEY_DB, source: 'quiz/request', category: 'transactional' },
        });
      } catch (err) {
        console.error('quiz email send failed:', err.message);
        log(env, waitUntil, 'quiz', 'email_send_error', 'error', 'email failed', 0, 0);
        try {
          await logEmailFailure(env.SURVEY_DB, {
            email,
            category: 'transactional',
            source: 'quiz/request',
            subject: emailSubject,
            detail: 'send failed',
          });
        } catch (logErr) { console.error('quiz logEmailFailure failed:', logErr.message); }
      }
    }

    return json({ ok: true });
  } catch (err) {
    console.error('quiz request unexpected error:', err);
    log(env, waitUntil, 'quiz', 'request_fail', 'error', 'unexpected error', 0, 500);
    return json({ error: 'server_error' }, 500);
  }
}

function buildEmailText(primary, alternate) {
  const lines = [
    `Your quiz result: ${primary.name}`,
    '',
    `${primary.name} is ${primary.tagline}.`,
    '',
    'The best next step is learning from a certified instructor. You can find one through:',
    `${primary.label}`,
    `${primary.url}`,
    '',
  ];

  if (alternate) {
    lines.push(`Also worth a look: ${alternate.name} is ${alternate.tagline}.`);
    lines.push('');
  }

  lines.push('Compare all fertility awareness methods at:');
  lines.push('https://rrmacademy.org/fertility-awareness-methods-compared/');
  lines.push('');
  lines.push('RRM Academy -- rrmacademy.org');

  return lines.join('\n');
}

/**
 * Shared body validation helper for CF Pages Functions.
 *
 * Usage:
 *   import { validateBody } from '../_validate.js';
 *
 *   const result = validateBody(body, {
 *     name:    { type: 'string', required: true, maxLength: 200 },
 *     email:   { type: 'email',  required: true },
 *     count:   { type: 'number', required: false, min: 1, max: 100 },
 *   });
 *   if (!result.valid) return json({ ok: false, error: result.error }, result.status);
 *   const { name, email, count } = result.data;
 *
 * Schema field options:
 *   type      'string' | 'number' | 'boolean' | 'email' | 'enum'  (required)
 *   required  true | false  (default: false)
 *   maxLength max string length (strings and emails)
 *   minLength min string length after trim
 *   min       minimum value (numbers)
 *   max       maximum value (numbers)
 *   values    allowed string values (enum only)
 *
 * Returns:
 *   { valid: true,  data: sanitizedBody }
 *   { valid: false, error: 'message',    status: 400 }
 *
 * Notes:
 *   - Unknown fields are stripped (only declared fields returned in data)
 *   - String values are trimmed before length checks
 *   - Numbers accept string inputs and coerce them (e.g. "42" -> 42)
 *   - Email type checks format only; use validateEmail/_elv for deep checks
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateBody(body, schema) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { valid: false, error: 'Invalid payload', status: 400 };
  }

  const data = {};

  for (const [field, rules] of Object.entries(schema)) {
    const raw = body[field];
    const missing = raw === undefined || raw === null || raw === '';

    if (missing) {
      if (rules.required) {
        return { valid: false, error: `${field} is required`, status: 400 };
      }
      continue;
    }

    if (rules.type === 'string') {
      if (typeof raw !== 'string') {
        return { valid: false, error: `${field} must be a string`, status: 400 };
      }
      const trimmed = raw.trim();
      if (rules.required && !trimmed) {
        return { valid: false, error: `${field} is required`, status: 400 };
      }
      if (rules.maxLength !== undefined && trimmed.length > rules.maxLength) {
        return { valid: false, error: `${field} is too long (max ${rules.maxLength} characters)`, status: 400 };
      }
      if (rules.minLength !== undefined && trimmed.length < rules.minLength) {
        return { valid: false, error: `${field} is too short (min ${rules.minLength} characters)`, status: 400 };
      }
      data[field] = trimmed;

    } else if (rules.type === 'email') {
      if (typeof raw !== 'string') {
        return { valid: false, error: `${field} must be a string`, status: 400 };
      }
      const trimmed = raw.normalize('NFC').trim().toLowerCase();
      if (!trimmed || trimmed.length > 254 || !EMAIL_RE.test(trimmed)) {
        return { valid: false, error: `${field} must be a valid email address`, status: 400 };
      }
      data[field] = trimmed;

    } else if (rules.type === 'number') {
      let num = raw;
      if (typeof raw === 'string') {
        num = Number(raw);
      }
      if (typeof num !== 'number' || !Number.isFinite(num)) {
        return { valid: false, error: `${field} must be a number`, status: 400 };
      }
      if (rules.min !== undefined && num < rules.min) {
        return { valid: false, error: `${field} must be at least ${rules.min}`, status: 400 };
      }
      if (rules.max !== undefined && num > rules.max) {
        return { valid: false, error: `${field} must be at most ${rules.max}`, status: 400 };
      }
      data[field] = num;

    } else if (rules.type === 'boolean') {
      if (typeof raw !== 'boolean') {
        return { valid: false, error: `${field} must be a boolean`, status: 400 };
      }
      data[field] = raw;

    } else if (rules.type === 'enum') {
      if (typeof raw !== 'string') {
        return { valid: false, error: `${field} must be a string`, status: 400 };
      }
      const trimmed = raw.trim();
      if (!Array.isArray(rules.values) || rules.values.length === 0) {
        return { valid: false, error: `${field} schema misconfigured (no values)`, status: 500 };
      }
      if (!rules.values.includes(trimmed)) {
        return { valid: false, error: `${field} must be one of: ${rules.values.join(', ')}`, status: 400 };
      }
      data[field] = trimmed;

    } else {
      return { valid: false, error: `Unknown type for ${field}`, status: 400 };
    }
  }

  return { valid: true, data };
}

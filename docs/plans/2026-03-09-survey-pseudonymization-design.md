# Survey Data Pseudonymization

> Approved: 2026-03-09
> Status: Ready for implementation

## Problem

The endo survey currently stores email + symptom data together in Airtable. A single breach exposes PII linked to health data. Pseudonymization splits identity from symptoms so neither system alone is useful to an attacker.

## Architecture

### New D1 Database

- **Name:** `rrm-survey`
- **Binding:** `SURVEY_DB`
- **Purpose:** Identity store for all surveys (current and future)

```sql
CREATE TABLE survey_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  airtable_record_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'endo-survey-v1',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_survey_identities_email ON survey_identities(email);
```

- `email` is not unique (same person can retake via new link)
- `airtable_record_id` is unique (one Airtable record per submission)
- `source` distinguishes survey type for future surveys
- Index on email for deletion requests and research lookups

### Airtable

- Existing `Email` field kept but left blank on new submissions
- Symptoms, scores, metadata remain in Airtable as before

### Data Separation

| System | Contains | Does NOT contain |
|--------|----------|------------------|
| D1 `survey_identities` | email, Airtable record ID, source | symptoms, scores |
| Airtable survey table | symptoms, scores, metadata | email (new records) |
| KV `SURVEY_TOKENS` | token, used flag, UTM params | email (stripped after submit) |

## Submit Flow (submit.js)

1. Validate KV token (unchanged)
2. Mark token used (unchanged)
3. POST symptoms to Airtable -- **without email**
4. Capture Airtable record ID from response
5. INSERT email + record ID + source into D1 `survey_identities`
6. Strip email from KV token data
7. Return success

### Failure handling (step 5)

If D1 write fails after Airtable write succeeds:
- Log error to Analytics Engine (triggers Telegram alert via pipeline events)
- Send alert email to administrator@rrmacademy.org via SES (fire-and-forget via waitUntil) with email + Airtable record ID for manual recovery
- Still return success to user (their survey data is saved)
- **Failure must NOT be silent** -- both alert channels fire

## Token Changes (request.js)

- `TOKEN_TTL`: 90 days -> **24 hours** (86400 seconds)
- Rate limit: 10 minutes (unchanged)
- After successful submission, KV token is overwritten with email stripped

## Migration Script

One-time script: `scripts/migrate-survey-identities.mjs`

1. Fetch all Airtable survey records with populated Email field
2. INSERT email + record ID into D1 with `source: 'endo-survey-v1-backfill'`
3. PATCH Airtable record to clear Email field
4. Batch in groups of 10 (Airtable API limit)
5. Progress logging, idempotent via UNIQUE constraint on airtable_record_id

Run manually. Not automated.

## Files Changed

| File | Change |
|------|--------|
| `wrangler.toml` | Add `SURVEY_DB` D1 binding |
| `functions/api/survey/submit.js` | Remove email from Airtable payload, add D1 write, strip KV email, failure alerts |
| `functions/api/survey/request.js` | TOKEN_TTL from 90d to 24h |
| `scripts/migrate-survey-identities.mjs` | New: one-time backfill migration |

## Security Notes

- Pseudonymous, not anonymous: record ID is the join key
- Both systems needed to re-identify a person
- Deletion requests: query D1 by email, get record IDs, delete from both systems
- Airtable base/table names never exposed publicly (attack surface)

// scripts/ai-search-provision.mjs
//
// Idempotent provisioning script for the /ask v2 AI Search rebuild (Phase 1a).
// Plan: docs/plans/2026-04-20-ask-v2-ai-search-rebuild.md
//
// Creates the production CF AI Search namespace and two instances:
//   - rrm-academy-search                  (namespace)
//     - rrm-academy-search-articles       (built-in storage, hybrid, custom_metadata schema)
//     - rrm-academy-search-site           (web-crawler, source rrmacademy.org, enable=false)
//
// Idempotency: every step does GET first, creates only if absent. Re-running is safe.
//
// CREDENTIAL INVENTORY:
//   CLOUDFLARE_API_TOKEN
//     1Password: op://Automation/Cloudflare API Token - AI Search Phase 1 (account-scoped)/credential
//     Required permissions: AI Search Write, Account Settings Read
//     IP-locked to 72.95.9.135 (Brian's home IP)
//     Expires: 2026-05-28
//   CF_ACCOUNT_ID
//     Default: ecf2c5bc8b5ebd634bcb587b3890910a (rrmacademy)
//     Override via env if running against a different account.
//
// USAGE:
//   export CLOUDFLARE_API_TOKEN=$(op read 'op://Automation/Cloudflare API Token - AI Search Phase 1 (account-scoped)/credential')
//   node scripts/ai-search-provision.mjs
//
// FLAGS:
//   --dry-run        Print actions without executing
//   --force-recreate Delete and recreate the namespace (DESTRUCTIVE — wipes all indexed docs)
//
// ABORT PATH: if instance creation or schema PUT fails AFTER namespace creation,
// the script automatically deletes the namespace to avoid orphaned partial state.
// Pass --no-rollback to disable this (debugging only).

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID || 'ecf2c5bc8b5ebd634bcb587b3890910a';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const NAMESPACE = 'rrm-academy-search';
const ARTICLES_INSTANCE = 'rrm-academy-search-articles';
const SITE_INSTANCE = 'rrm-academy-search-site';

const SCHEMA = [
  { field_name: 'type', data_type: 'text' },
  { field_name: 'year', data_type: 'number' },
  { field_name: 'domain', data_type: 'text' },
  { field_name: 'rrm_relevance', data_type: 'number' },
  { field_name: 'is_open_access', data_type: 'boolean' },
];

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FORCE_RECREATE = args.has('--force-recreate');
const NO_ROLLBACK = args.has('--no-rollback');

const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai-search`;

function log(...parts) {
  console.log(`[provision] ${parts.join(' ')}`);
}
function err(...parts) {
  console.error(`[provision][ERROR] ${parts.join(' ')}`);
}

async function cf(method, path, body) {
  if (DRY_RUN && method !== 'GET') {
    log(`DRY-RUN ${method} ${path}`, body ? JSON.stringify(body) : '');
    return { dryRun: true };
  }
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`CF ${method} ${path}: non-JSON response (${r.status}): ${text.slice(0, 300)}`);
  }
  if (!r.ok || json.success === false) {
    const msg = json.errors ? JSON.stringify(json.errors) : text.slice(0, 300);
    throw new Error(`CF ${method} ${path} -> ${r.status}: ${msg}`);
  }
  return json.result;
}

async function namespaceExists(name) {
  const result = await cf('GET', '/namespaces');
  const list = Array.isArray(result) ? result : result?.namespaces || [];
  return list.some((n) => n.name === name);
}

async function createNamespace(name) {
  log(`creating namespace ${name}`);
  return cf('POST', '/namespaces', {
    name,
    description: 'Production AI Search namespace for /ask v2 + /library semantic. Plan: docs/plans/2026-04-20-ask-v2-ai-search-rebuild.md',
  });
}

async function deleteNamespace(name) {
  log(`deleting namespace ${name} (rollback)`);
  if (DRY_RUN) {
    log(`DRY-RUN DELETE /namespaces/${name}`);
    return;
  }
  const r = await fetch(`${BASE}/namespaces/${name}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok && r.status !== 404) {
    throw new Error(`deleteNamespace ${name} -> ${r.status}`);
  }
}

async function listInstances(namespace) {
  const result = await cf('GET', `/namespaces/${namespace}/instances`);
  return Array.isArray(result) ? result : result?.instances || [];
}

async function createArticlesInstance(namespace) {
  log(`creating instance ${ARTICLES_INSTANCE} (built-in storage, hybrid_search_enabled)`);
  return cf('POST', `/namespaces/${namespace}/instances`, {
    id: ARTICLES_INSTANCE,
    hybrid_search_enabled: true,
  });
}

async function createSiteInstance(namespace) {
  log(`creating instance ${SITE_INSTANCE} (web-crawler, enable=false)`);
  return cf('POST', `/namespaces/${namespace}/instances`, {
    id: SITE_INSTANCE,
    type: 'web-crawler',
    source: 'rrmacademy.org',
    hybrid_search_enabled: true,
    enable: false,
  });
}

function schemasEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const sortFn = (x, y) => x.field_name.localeCompare(y.field_name);
  const sa = [...a].sort(sortFn);
  const sb = [...b].sort(sortFn);
  return sa.every((f, i) => f.field_name === sb[i].field_name && f.data_type === sb[i].data_type);
}

async function putSchema(namespace, instanceId) {
  if (!DRY_RUN) {
    const inst = await cf('GET', `/namespaces/${namespace}/instances/${instanceId}`);
    const current = inst?.custom_metadata || [];
    if (schemasEqual(current, SCHEMA)) {
      log(`schema on ${instanceId} already matches desired (5 fields); skip PUT`);
      return inst;
    }
    if (current.length > 0) {
      log(`schema on ${instanceId} differs: current=${JSON.stringify(current.map((f) => f.field_name))} desired=${JSON.stringify(SCHEMA.map((f) => f.field_name))}`);
      log(`PUT will REPLACE schema; existing items keep their old metadata. Pass --migrate-schema to acknowledge.`);
      if (!args.has('--migrate-schema')) {
        throw new Error('schema differs and --migrate-schema not set; refusing to silently mutate');
      }
    }
  }
  log(`PUT custom_metadata schema on ${instanceId}: ${SCHEMA.map((f) => f.field_name).join(', ')}`);
  return cf('PUT', `/namespaces/${namespace}/instances/${instanceId}`, {
    custom_metadata: SCHEMA,
  });
}

async function verifySchema(namespace, instanceId) {
  const inst = await cf('GET', `/namespaces/${namespace}/instances/${instanceId}`);
  const got = inst?.custom_metadata || [];
  const wantNames = SCHEMA.map((f) => f.field_name).sort();
  const gotNames = got.map((f) => f.field_name).sort();
  const match = JSON.stringify(wantNames) === JSON.stringify(gotNames);
  if (!match) {
    throw new Error(`schema verification failed: want=${JSON.stringify(wantNames)} got=${JSON.stringify(gotNames)}`);
  }
  for (const want of SCHEMA) {
    const found = got.find((f) => f.field_name === want.field_name);
    if (!found || found.data_type !== want.data_type) {
      throw new Error(`schema field type mismatch on ${want.field_name}: want=${want.data_type} got=${found?.data_type}`);
    }
  }
  log(`schema verified on ${instanceId}: 5 fields, all data_types match`);
}

async function main() {
  if (!TOKEN) {
    err('CLOUDFLARE_API_TOKEN not set in env. See CREDENTIAL INVENTORY at top of file.');
    process.exit(1);
  }
  log(`account: ${ACCOUNT_ID}`);
  log(`namespace: ${NAMESPACE}`);
  log(`instances: ${ARTICLES_INSTANCE}, ${SITE_INSTANCE}`);
  if (DRY_RUN) log('DRY-RUN MODE — no writes');
  if (FORCE_RECREATE) log('FORCE-RECREATE — will delete namespace first');

  let namespaceCreatedThisRun = false;

  try {
    if (FORCE_RECREATE) {
      const exists = await namespaceExists(NAMESPACE);
      if (exists) await deleteNamespace(NAMESPACE);
    }

    if (await namespaceExists(NAMESPACE)) {
      log(`namespace ${NAMESPACE} already exists (idempotent skip)`);
    } else {
      await createNamespace(NAMESPACE);
      namespaceCreatedThisRun = true;
    }

    const existing = DRY_RUN ? [] : await listInstances(NAMESPACE);
    const existingIds = new Set(existing.map((i) => i.id || i.name));

    if (existingIds.has(ARTICLES_INSTANCE)) {
      log(`instance ${ARTICLES_INSTANCE} already exists (idempotent skip create)`);
    } else {
      await createArticlesInstance(NAMESPACE);
    }

    await putSchema(NAMESPACE, ARTICLES_INSTANCE);
    if (!DRY_RUN) await verifySchema(NAMESPACE, ARTICLES_INSTANCE);

    if (existingIds.has(SITE_INSTANCE)) {
      log(`instance ${SITE_INSTANCE} already exists (idempotent skip)`);
    } else {
      await createSiteInstance(NAMESPACE);
    }

    log('PROVISION COMPLETE');
    log(`  namespace: ${NAMESPACE}`);
    log(`  articles instance: ${ARTICLES_INSTANCE} (5-field custom_metadata, hybrid)`);
    log(`  site instance: ${SITE_INSTANCE} (web-crawler, NOT enabled)`);
    log(`Next: apply D1 migration scripts/migrations/ai-search-docs.sql, then run scripts/ai-search-corpus-upload.mjs --dry-run`);
  } catch (e) {
    err(e.message);
    if (namespaceCreatedThisRun && !NO_ROLLBACK && !DRY_RUN) {
      err('rolling back namespace creation to avoid orphaned partial state');
      await deleteNamespace(NAMESPACE).catch((rbErr) => err(`rollback failed: ${rbErr.message}`));
    } else if (namespaceCreatedThisRun) {
      err('rollback skipped (--no-rollback or --dry-run); namespace may be in partial state');
    }
    process.exit(1);
  }
}

main();

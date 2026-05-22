# Orank Wave 2: second MCP surface on rrm-library-worker

**Date:** 2026-05-21
**Trigger:** Wave 1 closes 5 of 6 orank Agent Integration gaps. Wave 2 closes the last (`multi_surface_mcp_coverage`, +2 pts).
**Target:** push score from ~87 (Wave 1) to 89 (A-).

## Scope decision

Add a logically distinct second MCP server at **library.rrmacademy.org/mcp**, fronted by the existing `rrm-library-worker`. Reasons:

- The current `mcp.rrmacademy.org/mcp` is a high-level RAG MCP (semantic search + answer + guardrails over the library).
- The library worker exposes **low-level structured access** to the library (article metadata, classification status, ingest pipeline visibility, facts table). Different intent, different tool surface.
- `ssot/agent-surfaces.json` already advertises `https://library.rrmacademy.org/` as a content-corpus surface (currently dangling — no DNS record). Wave 2 fixes that dangling reference as a side effect.
- Rejected alternative: add `/library-mcp` subpath to `rrm-mcp` Worker. Same host, same auth, same Worker — the scanner is likely to treat that as one surface, and it muddles the conceptual separation.

## Architecture

```
rrm-academy-cf .well-known/
  mcp.json                          (apex MCP — existing, unchanged)
  mcp/server-card.json              (apex server card — existing, unchanged)
  mcp-library.json                  (NEW — library MCP descriptor)
  mcp/library-server-card.json      (NEW — library MCP server card)
  api-catalog                       (UPDATED — add library MCP to item[])
  agent-card.json                   (UPDATED — add mcp_servers[] listing both)

rrm-library-worker
  src/routes/mcp.js                 (NEW — JSON-RPC 2.0 handler)
  src/index.js                      (UPDATED — dispatch POST /mcp + GET /mcp)
  wrangler.toml                     (UPDATED — add [[routes]] block for library.rrmacademy.org/mcp*)

CF DNS
  library.rrmacademy.org A 192.0.2.1 (proxied) — created via CF API
```

## Wave 2 — files touched

### Step A — DNS + route

1. Verify rrmacademy.org zone token (`op://Automation/CF - DNS Editor - rrmacademy/credential`) has DNS:Edit on zone.
2. Create AAAA/A record for `library.rrmacademy.org` pointing at an arbitrary IP (CF Workers route ignores the target; just needs the proxy flag enabled).
3. Add `[[routes]]` to `rrm-library-worker/wrangler.toml`:
   ```
   [[routes]]
   pattern = "library.rrmacademy.org/mcp*"
   zone_name = "rrmacademy.org"
   ```
4. Deploy with the `CF - Worker Deploy - account` token (cf-token-heal if missing zone:Workers Routes:Edit).

### Step B — `rrm-library-worker` MCP handler

`src/routes/mcp.js` (new, ~250 lines):

- JSON-RPC 2.0 handler implementing the MCP spec subset:
  - `initialize` → return `protocolVersion`, `serverInfo`, `capabilities.tools`
  - `tools/list` → enumerate the 3 tools below with `inputSchema`
  - `tools/call` → dispatch by `params.name`
- Each tool returns `{ content: [{ type: 'text', text: JSON.stringify(result) }] }` per MCP convention.
- HTTP transport: streamable-http (matches apex MCP).
- Auth: tools/call requires Bearer token. Initialize + tools/list are unauthenticated. Reuse existing `BUILD_TOKEN` env binding for now; document self-service issuance as "ask administrator@rrmacademy.org" until we wire a self-service path (deferred).
- Rate limit: emit the same RFC 9598 headers introduced in Wave 1 using a new KV namespace (or reuse if the library worker has one).

Tools:

1. **`library_status`** — corpus stats. Wraps the existing `__statusCache` data. Returns `{ totalArticles, byType: {...}, byClassification: {...}, queueDepth: {...}, lastEnrichmentRun: '...' }`.
2. **`library_get_article`** — by id/slug/pmid/doi. Reuses existing `/article/{id}` D1 logic. Returns full article metadata + abstract.
3. **`library_search_metadata`** — keyword search by title/authors/abstract using D1 FTS5 (if available) or LIKE fallback. Returns up to 50 ArticleSummary objects. Distinct from the apex MCP's `search` (which is semantic/embedded).

### Step C — `rrm-academy-cf` discovery manifests

1. **`public/.well-known/mcp-library.json`** (new): mirror of `mcp.json` shape, scoped to the library MCP. Lists 3 tools, advertises `library.rrmacademy.org/mcp`, self-service auth flow points to same `/account/mcp-keys` page (deferred token issuance is fine for Wave 2 — discovery doesn't require working auth).
2. **`public/.well-known/mcp/library-server-card.json`** (new): mirror of `server-card.json`, scoped to library MCP.
3. **`public/.well-known/api-catalog`** (update): add a second `item` entry pointing at `library.rrmacademy.org/mcp`.
4. **`public/.well-known/agent-card.json`** (update): add `mcp_servers: [{...apex...}, {...library...}]` array.
5. **`public/openapi.json`** (update): `servers:` array adds `https://library.rrmacademy.org` with a description.
6. **`ssot/agent-surfaces.json`** (update): the dangling `library.rrmacademy.org/` entry now points at a real subdomain.
7. **`scripts/agent-discovery-check.mjs`** (update): add 3 new invariants:
   - mcp-library.json parses
   - library-server-card.json parses, tools match mcp-library.json
   - api-catalog `item[]` has ≥2 MCP entries

## Gates

- `npm run guard:agent-discovery` must still pass (with new invariants).
- Library worker must continue to pass its existing health checks (smoke `/health`, `/status`, `/articles`).
- Wave 1 ratelimit headers must remain on apex MCP and the new library MCP.

## Verification (post-deploy)

```bash
# Library subdomain resolves and serves
curl -s https://library.rrmacademy.org/health | jq

# Library MCP initialize works
curl -s -X POST https://library.rrmacademy.org/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' | jq

# Library MCP tools/list returns 3 tools
curl -s -X POST https://library.rrmacademy.org/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq '.result.tools[].name'

# Discovery manifests advertise both
curl -s https://rrmacademy.org/.well-known/mcp-library.json | jq .server_url
curl -s https://rrmacademy.org/.well-known/api-catalog | jq '.linkset[0].item | length'  # should be >=2
curl -s https://rrmacademy.org/.well-known/agent-card.json | jq '.mcp_servers | length'   # should be 2

# Orank rescan
curl -s -X POST https://ora.ai/api/scan -H 'Content-Type: application/json' \
  -d '{"url":"rrmacademy.org"}' | jq .score
```

## Revert

- DNS record + wrangler route are revertable independently. Removing the route does not affect the apex MCP.
- Two PRs: one in rrm-library-worker (worker + wrangler), one in rrm-academy-cf (manifests). Each git-revertable.

## Out of scope

- Self-service token issuance for library MCP. Document as `contact administrator@rrmacademy.org` for Wave 2. Self-service is its own piece of work.
- Migrating other library worker endpoints into MCP tool shapes (ingest, classify-result, etc.). Three read-only tools is enough for the scanner.

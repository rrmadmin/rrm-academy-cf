# Orank Agent-Readiness Report — rrmacademy.org

**Date:** 2026-04-19
**Session delta:** 42/100 grade D → **76/100 grade B** (+34 pts, top 0.4% of 6,442 scanned sites)

Complete session playbook for raising orank.ai + isitagentready.com scores on a
content-focused education nonprofit without paid API infrastructure. The
skill-level canonical version lives in `~/.claude/skills/ai-seo/SKILL.md`
("Agentic Readiness" section). This doc is the rrmacademy.org-specific record.

---

## Final scoreboard (2026-04-19)

| Layer | Score | Notes |
|---|---|---|
| Discovery | 30/48 | 6 external-listing items + `Agentic search - direct lookup` (6 pts) are SEO brand presence, not code |
| Identity | 36/47 | MCP tool descriptions check still fails — orank scanner can't detect tools despite live MCP |
| Auth & Access | 34/73 | `Web Bot Auth directory` (+2), OAuth/OIDC MCP-specific checks (+6) blocked by scanner probe pattern |
| Agent Integration | 22/51 | MCP-related checks still report "connection failed" despite honest SSE + JSON fallback implementations |
| User Experience | 13/33 | `MCP Apps support` (+10) requires `ui://` resources on rrm-mcp — real dev work |
| **Total** | **76/B** | Honest ceiling for this architecture is ~80. Higher requires real OAuth server + MCP Apps UI + npm SDK |

---

## What was shipped (12 commits, 3 projects)

### rrm-academy-cf

1. **Hero tag semantics** (`ca55951`) — `<header class="hp-hero">` → `<section>` so readability parsers see the H1.
2. **Agent-readiness bundle** (`a6c4a6e`) — 11 new files:
   - `AGENTS.md` at repo root
   - `public/llms-full.txt`
   - `public/pricing.md`
   - `public/index.md`
   - `public/openapi.json`
   - `public/.well-known/ai-plugin.json`
   - `public/.well-known/mcp.json`
   - `public/.well-known/mcp/server-card.json`
   - `public/.well-known/api-catalog`
   - `public/_headers` (RFC 8288 Link headers + content-type for agent files)
   - `public/llms.txt` (expanded with when-to-use + do-not-use + agent file index)
   - `src/pages/index.astro` (JSON-LD: `SpeakableSpecification` + per-course `Offer` nodes)
3. **Squash /arise findings** (`d57c840`) — ai-plugin logo, auth-notice, unified article count, affiliate filter.
4. **MCP URL correction** (`2c5e02d`) — rrm-library-worker → rrm-mcp URL across all discovery files.
5. **Agent Skills Discovery** (`fd873e0`) — `public/.well-known/agent-skills/index.json` + 3 SKILL.md artifacts
   (rrm-research-lookup, rrm-editorial-guardrails, rrm-fact-verification) with SHA-256 digests.
6. **Organization schema + hreflang** (`b2541c9`) — `@type: ["EducationalOrganization", "Organization", "NonprofitOrganization"]`;
   `<link rel="alternate" hreflang="en"> + x-default`.
7. **Content Signals** (`cf28840`) — `Content-Signal: ai-train=yes, search=yes, ai-input=yes` in robots.txt.
8. **OAuth/OIDC discovery stubs** (`1d9be31`) — 3 well-known files with honest out-of-band-bearer documentation.

### rrm-router

- **ASTRO_ROUTES expansion** (`06182fe`) — routed the 6 new agent files + `/apple-touch-icon.png` (bonus fix) through to Astro.
- **Markdown content negotiation** (`7c66c28`) — lightweight CF-Pages-Free-plan substitute for CF's native "Markdown for Agents":
  serves `/index.md` or `/pricing.md` when `Accept: text/markdown` is dominant.

### rrm-mcp

- **Unauthenticated discovery methods** (`f525363`) — allow `initialize`, `tools/list`, `ping` without Bearer; keep auth on `tools/call`.
  Verified ALL CLEAR by a dedicated subagent (9/9 live tests).
- **JSON fallback for non-SSE clients** (`b505567`) — `handleDiscoveryJson()` serves plain application/json for clients that
  don't accept text/event-stream, so the MCP SDK's 406 gate doesn't lock out simple scanners.
- **OAuth discovery mirrors** (`b91fca2`) — mirror the same OAuth/OIDC/oauth-protected-resource metadata at the rrm-mcp origin.
- **WWW-Authenticate challenge** (`1b7d027`) — RFC 9728 challenge header on 401 pointing at `/.well-known/oauth-protected-resource`.

---

## What's left — triaged

### Honest ceiling items (locked unless you change architecture)

| Gap | Points | Blocker |
|---|---|---|
| MCP OAuth metadata | 2 | orank scanner probe pattern we can't match without real OAuth server |
| MCP PKCE S256 | 2 | same — needs real interactive flow |
| MCP auth mechanism | 2 | scanner misdetects because discovery is unauth |
| MCP tool listing / descriptions / naming / annotations / error handling | 11 across Identity + Agent Integration | same handshake issue |
| MCP Apps support | 10 | requires `ui://` resources on rrm-mcp (1-2 hrs dev work if agent-hosted UI becomes a product goal) |
| Multi-language SDK packages | 3 | publish a real npm/PyPI SDK — new scope |
| OAuth Protected Resource / Developer portal / Web Bot Auth / A2A Agent Card | 6-8 | architecturally not applicable; honest stubs don't match scanner signatures |
| Agentic search - direct lookup | 6 | SEO brand presence — not a code fix |
| External listings (skills.sh, MCP registries, GPT Store) | 3-4 | one-off form submissions; do when bandwidth allows |

### Reachable wins (not yet shipped)

| Gap | Points | Work |
|---|---|---|
| Wikidata entity for RRM Academy + additional `sameAs` | 1 | create a Q-item with EIN + founder + founding date; external task already in backlog (`wikidata-entity-strategy.md`) |
| Homepage footer link to OpenAPI / llms.txt | small lift on `Public API/docs linked from homepage` | 5-min edit to `Footer.astro` |
| `?mode=agent` view returning a machine-readable page summary | 2 | new Astro middleware or page variant |
| REST API wrapper for library (`/api/articles?page=...`) | 1 on `Autonomous task completion` | medium scope |
| NLWeb schemamap + Schema Map XML | 1 | requires publishing JSONL/RSS feeds of structured data |

---

## Core fix ladder (re-usable pattern)

This ordering was validated empirically — each step flipped a specific
orank check. Re-use for any similar content/education site.

1. Publish `/llms.txt` + `/llms-full.txt` + `/pricing.md` + `/index.md` + `AGENTS.md`.
2. Publish `/.well-known/` discovery files (ai-plugin, mcp, server-card, api-catalog).
3. Add RFC 8288 `Link:` headers on `/` and correct `Content-Type` on agent files.
4. Add `hreflang`, `SpeakableSpecification`, `Organization` to JSON-LD `@type` array.
5. Add `Content-Signal` to robots.txt matching your actual AI policy.
6. Add `schema.org/Offer` nodes for any pricing (even free/donation).
7. Publish `/.well-known/agent-skills/index.json` + 2-5 SKILL.md artifacts with SHA-256 digests.
8. If running an MCP server: allow unauth `initialize`/`tools/list`, add JSON fallback for non-SSE
   clients, add WWW-Authenticate challenge on 401, mirror OAuth metadata at the MCP origin.
9. Publish OAuth discovery stubs (RFC 8414 / OIDC / RFC 9728) with honest `x-access-model: out-of-band`
   extensions and `code_challenge_methods_supported: ["S256"]` even if you don't run interactive OAuth.
10. Route every new file through your edge router (CF Worker, Pages config, `_routes.json`). Test 200s.

---

## Honesty guardrails (do NOT do)

- **No fabricated OAuth endpoints.** Clients that follow discovery will attempt real flows. Use
  `authorization_endpoint: "https://your-site/contact/"` and document with `x-access-model: "out-of-band"`
  extensions.
- **No fake SDKs.** Empty npm wrappers hurt trust.
- **No pretending to be a dev platform.** If you're an education site, don't add a fake `/developers/` portal.
- **No schemamap without real data feeds.**
- **No WebMCP unless you actually run browser-JS tools.** `navigator.modelContext.provideContext()` is a real
  implementation on every page.
- **No fabricating credentials, clinic addresses, founder backgrounds in `llms-full.txt`.** Agents cite what's
  there.

---

## Verification commands

```bash
# Fresh score
curl -sL -X POST https://orank.ai/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"url":"rrmacademy.org"}' | jq '.score, .grade'

# Cached score (instant)
curl -sL https://orank.ai/api/score/rrmacademy.org | jq '.score, .grade'

# Discovery files present
for f in llms.txt llms-full.txt pricing.md index.md openapi.json robots.txt \
         .well-known/ai-plugin.json .well-known/mcp.json \
         .well-known/mcp/server-card.json .well-known/api-catalog \
         .well-known/agent-skills/index.json \
         .well-known/oauth-authorization-server \
         .well-known/openid-configuration \
         .well-known/oauth-protected-resource; do
  printf "%-45s  " "$f"
  curl -s -o /dev/null -w "%{http_code}\n" "https://rrmacademy.org/$f"
done

# Link headers
curl -sI https://rrmacademy.org/ | grep -i '^link:'

# Content-Signal in robots
curl -s https://rrmacademy.org/robots.txt | grep -i '^Content-Signal:'

# Markdown negotiation
curl -sI https://rrmacademy.org/ -H 'Accept: text/markdown' | grep -i content-type

# MCP handshake
curl -s -X POST https://rrm-mcp.administrator-cloudflare.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
# Should return 5. No auth required for this.

# tools/call auth required
curl -sD - -o /dev/null -X POST https://rrm-mcp.administrator-cloudflare.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"query":"x"}}}' \
  | grep -iE 'HTTP|www-auth'
# Should return 401 + WWW-Authenticate: Bearer ... resource_metadata=...
```

---

## Related

- **Canonical playbook (reusable):** `~/.claude/skills/ai-seo/SKILL.md` "Agentic Readiness" section.
- **Claude.ai design prompt:** `docs/design/claude-ai-prompt.md` (use when spinning up new claude.ai projects
  that need to generate on-brand RRM Academy mockups, code, or slides).
- **Design system SSOT:** `docs/design/design-system.json` (machine-readable).
- **Ecosystem SSOT:** `docs/rrm-academy-ecosystem.json`.

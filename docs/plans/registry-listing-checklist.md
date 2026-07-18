# MCP Registry & Skills Listing Checklist

**Status:** Research + artifact prep only. No accounts created, nothing submitted.
**Prepared:** 2026-07-18 (agent-readiness batch 2)
**Owner action required:** a human must create/sign-in to each registry and paste the prepared values.

## What we are listing

| Asset | Value |
| --- | --- |
| MCP server (remote) | `https://mcp.rrmacademy.org/mcp` |
| Transport | `streamable-http` (Streamable HTTP) |
| Protocol version | `2025-06-18` |
| Auth | Bearer token, self-service keys at https://rrmacademy.org/account/mcp-keys (tool discovery is unauthenticated) |
| Server card | https://mcp.rrmacademy.org/.well-known/mcp/server-card.json |
| MCP descriptor | https://rrmacademy.org/.well-known/mcp.json |
| Setup / docs page | https://rrmacademy.org/connect |
| Public repo | https://github.com/rrmadmin/rrm-academy-cf |
| Tools | `search`, `get_article`, `find_related`, `check_guardrails`, `check_facts` |
| Contact | info@rrmacademy.org |

Canonical short description (reuse verbatim):

> RRM Academy MCP server. Search 4,000+ peer-reviewed articles on restorative
> reproductive medicine, NaProTechnology, fertility awareness-based methods,
> endometriosis, and PCOS; retrieve full records; verify statistical claims
> against a curated facts database; and check drafts against RRM editorial
> guardrails. Free, self-service Bearer keys.

---

## 1. Smithery (smithery.ai)

**Mechanism (verified 2026-07-18):** Smithery is an MCP server registry + hosting
platform. Its registry API is at `https://registry.smithery.ai` (read: `GET
/servers`, `GET /servers/{qualifiedName}`). Adding a server to the index requires
**GitHub OAuth sign-in on the dashboard** — there is no unauthenticated public-PR
or public-API submission path for a *remote* third-party server. Two supported
routes:

- **Route A — Deploy/host in Smithery (repo-connected):** for servers whose code
  lives in a GitHub repo, add a `smithery.yaml` at the repo root and connect the
  repo in the Smithery dashboard. Not our case: our server is already hosted at
  `mcp.rrmacademy.org` (Cloudflare Worker), and its code is not in a standalone
  public MCP-server repo.
- **Route B — Add a remote server (our case):** sign in at smithery.ai with
  GitHub, choose "Add Server" / "Connect a remote MCP server", and register the
  remote URL. This is the correct path for `https://mcp.rrmacademy.org/mcp`.

**Human steps (~10 min):**
1. Go to https://smithery.ai and click **Sign in** → authorize with the `rrmadmin` GitHub account.
2. Click **Add Server** (a.k.a. "Deploy" → "Connect remote server").
3. Choose **Remote server** and enter:
   - Server URL: `https://mcp.rrmacademy.org/mcp`
   - Transport: **Streamable HTTP**
   - Auth: **Bearer / API key** — note keys are issued at https://rrmacademy.org/account/mcp-keys
4. Paste the canonical short description (above) and set homepage `https://rrmacademy.org/connect`.
5. Confirm the tool list auto-populates from `tools/list` (5 tools). If Smithery
   asks for a config schema, point it at the server card:
   `https://mcp.rrmacademy.org/.well-known/mcp/server-card.json`.
6. Set category/tags: `healthcare`, `research`, `medical-literature`, `rag`.
7. Save. Verify the public listing renders the 5 tools and the auth note.

**`smithery.yaml` (only if Smithery ever asks to repo-connect — otherwise skip):**
```yaml
# smithery.yaml — remote MCP server descriptor for RRM Academy
startCommand:
  type: http
  url: https://mcp.rrmacademy.org/mcp
  transport: streamable-http
metadata:
  name: RRM Academy
  description: >-
    Search 4,000+ peer-reviewed articles on restorative reproductive medicine,
    retrieve full records, verify statistical claims, and check drafts against
    RRM editorial guardrails.
  homepage: https://rrmacademy.org/connect
  documentation: https://rrmacademy.org/connect
  contact: info@rrmacademy.org
```
> DO NOT commit `smithery.yaml` to `rrm-academy-cf` root unless Smithery repo-connect
> is actually chosen; it would advertise a config we do not use.

---

## 2. mcp.so

**Mechanism (verified 2026-07-18):** community MCP directory (open-source site
`github.com/chatmcp/mcp-directory`; live at https://mcp.so). Listing is via the
site's **Submit** flow (GitHub sign-in), not a code PR to the directory content.
The site indexes both GitHub-hosted servers and remote servers.

**Human steps (~10 min):**
1. Go to https://mcp.so and click **Submit** (top nav). Sign in with GitHub if prompted.
2. Fill the form with:
   - Name: `RRM Academy`
   - Server URL / endpoint: `https://mcp.rrmacademy.org/mcp`
   - Repository / homepage: `https://rrmacademy.org/connect` (or the GitHub repo `https://github.com/rrmadmin/rrm-academy-cf`)
   - Description: the canonical short description above
   - Category/tags: `Health`, `Research`, `Search`
   - Auth note: Bearer key, self-service at https://rrmacademy.org/account/mcp-keys
3. Submit. mcp.so listings are reviewed; expect the entry to appear within a day or two.
4. Fallback if the form is unavailable: the maintainer accepts submissions via the
   community channels linked in `chatmcp/mcpso` README (Telegram / Discord / X
   @chatmcp). Post the name + endpoint + description.

**No unauthenticated public-PR path** to add a listing (the GitHub repo is the site
engine, not the listing datastore), so nothing is pre-staged as a PR here.

---

## 3. skills.sh (Vercel Labs)

**Mechanism (verified 2026-07-18):** skills.sh is a **leaderboard**, not a submit
form. It is populated automatically from anonymous install telemetry emitted by the
`skills` CLI (`github.com/vercel-labs/skills`). A "skill" is a **public GitHub repo
containing one or more `SKILL.md` files**, installable via `npx skills add owner/repo`.
A skill appears on skills.sh once it is public and starts accruing installs.

**Important scoping note:** our three "agent skills" currently live as MCP *tools*
plus `ssot/agent-surfaces.json` skill entries — they are **not** packaged as
Vercel-format `SKILL.md` repos. To list on skills.sh we must first publish a public
repo of `SKILL.md` files. This is a build task, not a paste-in-a-form task. Decide
first whether skills.sh (a coding-agent skills directory) is the right surface for
clinical MCP tools, or whether Smithery + mcp.so already cover the intended audience.

**If we proceed (human + small build, ~1-2 hr):**
1. Create a public repo, e.g. `rrmadmin/rrm-academy-skills`.
2. Add one `SKILL.md` per skill (candidate set, mirroring `ssot/agent-surfaces.json`):
   - `library-search/SKILL.md` — research library search via the MCP `search` tool.
   - `check-guardrails/SKILL.md` — validate RRM drafts via `check_guardrails`.
   - `check-facts/SKILL.md` — verify RRM statistics via `check_facts`.
   Each `SKILL.md` front-matter: `name`, `description`, and setup pointing at
   `https://mcp.rrmacademy.org/mcp` + `https://rrmacademy.org/connect`.
3. Confirm installability locally: `npx skills add rrmadmin/rrm-academy-skills` (do
   this from a throwaway dir; it emits anonymous telemetry that seeds the leaderboard).
4. Add the badge to the repo README:
   ```
   [![skills.sh](https://skills.sh/b/rrmadmin/rrm-academy-skills)](https://skills.sh/rrmadmin/rrm-academy-skills)
   ```
5. The listing surfaces on https://skills.sh/rrmadmin/rrm-academy-skills automatically
   as installs accrue. No form, no account required.

---

## Summary

| Registry | Path | Auth to list | Pre-staged artifact | Blocked on |
| --- | --- | --- | --- | --- |
| Smithery | Dashboard "Add remote server" | GitHub sign-in | `smithery.yaml` drafted (use only if repo-connect) | human sign-in |
| mcp.so | Site Submit form | GitHub sign-in | field values drafted | human sign-in |
| skills.sh | Publish `SKILL.md` repo → CLI telemetry | none | repo layout + badge drafted | decision + repo build |

Nothing above has been submitted. All three require either a human sign-in or a
new public repo before anything goes live.

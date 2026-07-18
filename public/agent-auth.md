# API Authentication for AI Agents

Markdown twin of https://rrmacademy.org/agent-auth/

Step-by-step guide for AI agents, developers, and automation scripts: generate a
free RRM Academy Bearer API token and authenticate programmatically against the
MCP server and OpenAPI 3.1 endpoints.

## At a glance

| Field | Value |
| --- | --- |
| Auth model | Self-service. Free with any RRM Academy account. |
| Token type | Bearer (HTTP `Authorization` header) |
| Standard | RFC 6750 + RFC 9728 (protected resource metadata) |
| Scopes | `mcp:read`, `mcp:invoke`, `library:read`, `faq:read` |
| Resource metadata | https://rrmacademy.org/.well-known/oauth-protected-resource |

## Step-by-step token guide

Every step happens in your browser or a script — no manual approval, no support
tickets.

1. **Create a free RRM Academy account.** Visit https://rrmacademy.org/signup. Email + password, or sign in with Google. Free for clinicians, researchers, and developers.
2. **Open the API key page.** Once signed in, go to https://rrmacademy.org/account/mcp-keys — your personal API key management page.
3. **Generate a new API token.** Click **Generate new key**. Label it for where you'll use it (for example `Claude Desktop`, `Perplexity Pro`, `my-agent-script`). Copy the displayed token immediately — it is shown only once.
4. **Store the API token securely.** Treat it like a password. Use a secrets manager (1Password, Doppler, AWS Secrets Manager, environment variables) — never commit it to git, never paste it into chat. The token has no expiration; rotate it from the same page whenever you need to.
5. **Send the API token with each request.** Add `Authorization: Bearer YOUR_API_KEY` as an HTTP header. The MCP server endpoint is `https://mcp.rrmacademy.org/mcp`. The HTTP API is documented at https://rrmacademy.org/openapi/.
6. **Discover tools without authentication.** The MCP `initialize` handshake and `tools/list` call work without a Bearer token — your client can enumerate capabilities first, then authenticate before the first `tools/call`. This matches the official MCP authentication spec.
7. **Revoke or rotate any time.** Each labelled token is independent. Revoke from https://rrmacademy.org/account/mcp-keys — revocation takes effect immediately. Other keys keep working.

## Authenticated request examples

### curl

```
curl -X POST https://mcp.rrmacademy.org/mcp \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "tools/call",
    "params": {
      "name": "search",
      "arguments": { "query": "endometriosis excision outcomes" }
    }
  }'
```

### Python

```
import os, httpx

API_KEY = os.environ["RRMACADEMY_API_KEY"]

async with httpx.AsyncClient() as client:
    r = await client.post(
        "https://mcp.rrmacademy.org/mcp",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Accept": "application/json, text/event-stream",
        },
        json={
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "search",
                       "arguments": {"query": "PCOS Letrozole"}},
        },
    )
    print(r.json())
```

### Node.js (fetch)

```
const apiKey = process.env.RRMACADEMY_API_KEY;

const res = await fetch("https://mcp.rrmacademy.org/mcp", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "check_facts",
              arguments: { text: "Endometriosis affects 10% of women." } },
  }),
});
console.log(await res.json());
```

## HTTP response codes

Standard REST semantics. All errors return JSON with a stable `error` field.

- **200** — Success. JSON or SSE payload.
- **400** — Invalid request (malformed JSON-RPC envelope, invalid tool name, parameter validation failure).
- **401** — Missing or invalid Bearer API token. The response carries a `WWW-Authenticate: Bearer resource_metadata="https://rrmacademy.org/.well-known/oauth-protected-resource"` header. Re-check the `Authorization` header.
- **403** — Token is valid but lacks the required scope.
- **429** — Rate limited. Back off and retry with exponential jitter.
- **500 / 503** — Server or upstream library worker error. Safe to retry.

## Programmatic discovery

An AI agent can discover the API surface, authentication requirements, and tool
catalog without a human in the loop.

- https://rrmacademy.org/.well-known/oauth-protected-resource — RFC 9728 metadata: bearer methods, scopes, auth flow, server endpoint.
- https://rrmacademy.org/.well-known/mcp.json — MCP descriptor: server URL, transport, capabilities, authentication block.
- https://mcp.rrmacademy.org/.well-known/mcp/server-card.json — Full tool catalog with JSON Schema input contracts.
- https://rrmacademy.org/openapi.json — OpenAPI 3.1 spec: endpoints, response shapes, error codes.
- https://rrmacademy.org/openapi/ — Rendered OpenAPI reference.
- https://rrmacademy.org/.well-known/api-catalog — RFC 9727 catalog pointing at every API surface.

## Security model

- **Token storage:** Bearer tokens are hashed at rest (we never store the plaintext). Lost the token? Generate a new one — there is no recovery flow by design.
- **Transport:** HTTPS only. Plaintext HTTP is rejected at the edge.
- **Rate limiting:** Per-token, scoped to billed downstream services (AI inference, vector search). Hit a 429? Back off.
- **Revocation:** Immediate. https://rrmacademy.org/account/mcp-keys shows last-used timestamps so you can audit token activity.
- **Scope of access:** Tokens grant read access to the research library and the ability to call MCP tools. They cannot modify any RRM Academy data, post comments, or access another user's account.

## Related developer pages

- https://rrmacademy.org/connect/ — Per-client setup guide (Claude, ChatGPT, Perplexity).
- https://rrmacademy.org/openapi/ — API documentation (OpenAPI 3.1 rendered).
- https://rrmacademy.org/webhooks/ — Webhooks and subscription channels.
- https://rrmacademy.org/llms.txt — Site index for AI crawlers.
- https://rrmacademy.org/agents.md — Agent instructions in markdown.
- Setup help: info@rrmacademy.org

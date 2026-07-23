# Developers

Markdown twin of https://rrmacademy.org/developers/

RRM Academy runs a free, public API surface for AI agents and developers: a
research library search, a grounded question-answering endpoint, OpenAPI 3.1
documentation, machine-readable discovery files, and a no-auth sandbox for
integration testing.

## Quickstart

Three steps from zero to your first authenticated call. Everything below is
self-service and free.

1. **Create a free account.** Visit https://rrmacademy.org/signup. Email and password, or sign in with Google. Free for clinicians, researchers, and developers.
2. **Generate an API key.** Once signed in, open https://rrmacademy.org/account/mcp-keys and click **Generate new key**. Copy the token immediately, it is shown only once. Use it as an HTTP `Authorization: Bearer YOUR_API_KEY` header.
3. **Make your first request.** No key is needed to reach the liveness probe. Confirm connectivity first, then call an authenticated endpoint.

The unauthenticated health check returns the literal string `ok`:

```
curl https://rrmacademy.org/health
# ok
```

An authenticated search call against the MCP server:

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

## API keys

Keys are self-service. Issue and revoke them yourself at
https://rrmacademy.org/account/mcp-keys. There is no approval step and no support
ticket.

- **Auth model** - Bearer token in the HTTP `Authorization` header. Free with any RRM Academy account.
- **Issuance** - Self-service at https://rrmacademy.org/account/mcp-keys. Label each key for where you use it.
- **Rotation** - Generate or revoke any time. Revocation is immediate; other keys keep working.

The full authentication flow, scopes, and code samples for curl, Python, and
Node.js are in the agent auth guide at https://rrmacademy.org/agent-auth/.

## Documentation

The API is documented for both humans and machines. Every surface below is
public and stable.

- https://rrmacademy.org/openapi/ - OpenAPI 3.1 reference: endpoints, request and response schemas, auth, and error codes.
- https://rrmacademy.org/openapi.json - Raw OpenAPI 3.1 spec.
- https://rrmacademy.org/agent-auth/ - Step-by-step Bearer token authentication with curl, Python, and Node.js samples.
- https://rrmacademy.org/webhooks/ - Webhooks and subscription channels (library and commentary RSS, MCP polling).
- https://rrmacademy.org/connect/ - Per-client MCP setup guide for Claude, ChatGPT, and Perplexity.
- https://rrmacademy.org/llms.txt and https://rrmacademy.org/llms-full.txt - site index and expanded corpus for AI crawlers.
- https://rrmacademy.org/agents.md - agent instructions in markdown.
- https://rrmacademy.org/pricing.md - pricing summary in markdown.
- https://rrmacademy.org/library-feed.jsonl - structured JSONL feed of every published library article.
- https://rrmacademy.org/.well-known/api-catalog - RFC 9727 catalog pointing at every API surface.

## Sandbox

The API includes a no-auth sandbox endpoint for the question-answering contract
at `POST /api/ask/sandbox`. It returns a canned, deterministic response with no
authentication, no rate limit, no LLM invocation, and no data mutation, so it is
safe to call from any client any number of times. It accepts the same JSON shape
as `/api/ask` but ignores the request body. Use it to validate that your client
correctly parses the answer shape before you integrate with the authenticated
endpoint.

```
curl -X POST https://rrmacademy.org/api/ask/sandbox \
  -H "Content-Type: application/json" \
  -d '{ "message": "test" }'

# {
#   "sandbox": true,
#   "answer": "Sandbox response. ...",
#   "citations": [ ... ]
# }
```

Every sandbox response carries an `X-Sandbox: true` header. Set
`Accept: text/event-stream` for the Server-Sent Events variant, which emits the
same payload followed by a `[DONE]` event. The sandbox is also described under
`info.x-sandbox` in the OpenAPI spec at https://rrmacademy.org/openapi.json.

## Rate limits

Authenticated API responses carry standard rate-limit headers so your client can
pace itself without guessing:

- **RateLimit-Limit** - requests allowed in the current window.
- **RateLimit-Remaining** - requests left in the current window.
- **RateLimit-Reset** - seconds until the window resets.

A `429` response means you have hit the limit. Back off and retry with
exponential jitter. The no-auth sandbox is not rate limited.

## Related developer pages

- https://rrmacademy.org/agent-auth/ - Step-by-step API token authentication guide.
- https://rrmacademy.org/openapi/ - API documentation (OpenAPI 3.1).
- https://rrmacademy.org/webhooks/ - Webhooks and subscription channels.
- https://rrmacademy.org/connect/ - Per-client MCP setup guide.
- Questions: info@rrmacademy.org

Source: https://rrmacademy.org/developers/

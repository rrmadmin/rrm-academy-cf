# auth.md

Agent registration and authentication guide for RRM Academy (rrmacademy.org).

**Audience:** AI agents, MCP clients, and developers automating access to the
RRM Academy research library, glossary, and FAQ tools.

RRM Academy is a nonprofit education platform for restorative reproductive
medicine (RRM). The MCP server at `https://mcp.rrmacademy.org/mcp` gives
agents direct access to a research library of thousands of indexed peer-reviewed
articles plus glossary lookup and FAQ retrieval.

## Discovery

| Resource | URL |
| --- | --- |
| Protected resource metadata | https://rrmacademy.org/.well-known/oauth-protected-resource |
| Authorization server metadata | https://rrmacademy.org/.well-known/oauth-authorization-server |
| MCP server | https://mcp.rrmacademy.org/mcp |
| Agent card | https://rrmacademy.org/.well-known/agent-card.json |
| OpenAPI 3.1 | https://rrmacademy.org/openapi.json |
| Human setup guide | https://rrmacademy.org/connect/ |

DNS-AID discovery records are published at `_index._agents.rrmacademy.org`
and `_mcp._agents.rrmacademy.org` (SVCB, DNSSEC-signed).

## Identity and credential model

- **Identity type:** verified email (a free RRM Academy account)
- **Credential type:** personal Bearer API key, self-service, displayed once at creation
- **No interactive OAuth code flow.** Keys are minted on a web page after sign-in.
- MCP `initialize` and `tools/list` are unauthenticated so clients can
  enumerate capabilities; `tools/call` requires the Bearer key.

## Register

Registration is self-service and free. No approval queue.

1. Create a free account at https://rrmacademy.org/signup (or sign in at https://rrmacademy.org/login).
2. Visit https://rrmacademy.org/account/mcp-keys.
3. Click "Generate new key", label it (for example "Claude Desktop" or
   "Perplexity"), and copy the displayed token. The token is shown once.

## Use

Configure your MCP client with server URL `https://mcp.rrmacademy.org/mcp`
(streamable HTTP transport) and send the key on every tool call:

```
Authorization: Bearer <key>
```

Scopes granted to every key: `mcp:read`, `mcp:invoke`, `library:read`,
`faq:read`.

## Revoke and rotate

Revoke or rotate keys at any time at https://rrmacademy.org/account/mcp-keys.
Revocation takes effect immediately.

## Terms

- Terms of use: https://rrmacademy.org/terms-of-use/
- Privacy policy: https://rrmacademy.org/privacy-policy/
- Medical disclaimer: https://rrmacademy.org/medical-disclaimer/

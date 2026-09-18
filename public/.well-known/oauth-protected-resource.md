# OAuth Protected Resource Metadata

Markdown twin of https://rrmacademy.org/.well-known/oauth-protected-resource

RFC 9728 protected resource metadata for the RRM Academy MCP server. The
protected resource is https://mcp.rrmacademy.org and its authorization server
is the same host, whose own metadata documents are authoritative. Access is an
OAuth 2.1 authorization code flow with PKCE (S256), one scope, `public`.

Free self-service Bearer API keys remain a supported alternative: create an
account, generate a key at https://rrmacademy.org/account/mcp-keys, and send it
as `Authorization: Bearer <key>`. Keys are managed on that page; OAuth grants
are not listed there and are ended by disconnecting the connector.

```json
{
  "resource": "https://mcp.rrmacademy.org",
  "authorization_servers": ["https://mcp.rrmacademy.org"],
  "scopes_supported": ["public"],
  "bearer_methods_supported": ["header"],
  "resource_name": "RRM Academy",
  "resource_documentation": "https://rrmacademy.org/connect",
  "resource_policy_uri": "https://rrmacademy.org/terms-of-use/",
  "resource_tos_uri": "https://rrmacademy.org/terms-of-use/",
  "x-authoritative-metadata": "https://mcp.rrmacademy.org/.well-known/oauth-protected-resource",
  "x-auth-flow": [
    "Step 1: Register the client at POST https://mcp.rrmacademy.org/oauth/register (RFC 7591 dynamic client registration, public clients only).",
    "Step 2: Send the account holder to https://mcp.rrmacademy.org/oauth/authorize with response_type=code, client_id, redirect_uri, code_challenge and code_challenge_method=S256.",
    "Step 3: The account holder signs in at rrmacademy.org if needed, then approves the connection on the consent page.",
    "Step 4: Exchange the code at POST https://mcp.rrmacademy.org/oauth/token with the PKCE code_verifier. The response carries an access token (1 hour) and a rotating refresh token (30 days).",
    "Step 5: Call https://mcp.rrmacademy.org/mcp with Authorization: Bearer <access token>. tools/list and initialize stay unauthenticated.",
    "Step 6: OAuth access ends when the account holder disconnects the connector in the AI app, which calls POST https://mcp.rrmacademy.org/oauth/revoke. API keys are managed separately at https://rrmacademy.org/account/mcp-keys, which does not list OAuth grants."
  ],
  "x-streaming": true,
  "x-streaming-transports": ["streamable-http", "text/event-stream"],
  "x-connect-page": "https://rrmacademy.org/connect",
  "x-contact": "info@rrmacademy.org",
  "x-legacy-api-keys": "Personal Bearer API keys issued at https://rrmacademy.org/account/mcp-keys remain valid alongside OAuth. They are free and self-service: create an account, generate a key, send it as Authorization: Bearer <key>."
}
```

Source: https://rrmacademy.org/.well-known/oauth-protected-resource

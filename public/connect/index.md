# Connect any AI to RRM Academy

Markdown twin of https://rrmacademy.org/connect/

A free Model Context Protocol (MCP) connector that gives Claude, ChatGPT, and
Perplexity direct access to the RRM Academy research library, editorial
guardrails, and verified clinical statistics. Free, 5-minute setup.

## Get your API key

Free with any RRM Academy account. Generate, label, and revoke keys per device —
Claude Desktop, ChatGPT, Perplexity Pro, or your own scripts.

- Generate keys: https://rrmacademy.org/account/mcp-keys
- Create a free account: https://rrmacademy.org/signup

## Connection details

Every AI client asks for the same two values.

| Field | Value |
| --- | --- |
| Server URL | `https://mcp.rrmacademy.org/mcp` |
| Transport | Streamable HTTP |
| Auth method | API key (Bearer token) |
| API key | Generated at https://rrmacademy.org/account/mcp-keys |

## Per-client setup

### Claude (claude.ai) — Pro, Team, Enterprise

1. Open claude.ai and sign in.
2. Click your profile picture (bottom-left) → Settings.
3. Go to Connectors → Add custom connector.
4. Fill in: Name `RRM Academy`, Server URL `https://mcp.rrmacademy.org/mcp`, Auth `Bearer token`, API key (paste your key).
5. Click Add. Five tools appear when the connection succeeds.
6. In any chat, open the Search and tools menu and enable RRM Academy.

### Claude Desktop — macOS & Windows

1. Open Claude Desktop.
2. Menu bar → Claude → Settings (macOS), or File → Settings (Windows).
3. Open the Connectors tab → Add custom connector.
4. Use the same field values as the web setup above.
5. Save. The five RRM Academy tools appear in the tools picker.

If you don't see "Connectors", update Claude Desktop — recent versions added
remote MCP support.

### ChatGPT — Pro, Business, Enterprise

1. Open chatgpt.com or the desktop app.
2. Profile icon (top-right) → Settings.
3. Open Connectors → Add → Custom MCP server.
4. Fill in: Name `RRM Academy`, Server URL `https://mcp.rrmacademy.org/mcp`, Authentication API key / Bearer token, API key (paste your key).
5. Save. ChatGPT lists the five tools on success.
6. In a chat, open the tools picker and enable RRM Academy.

Deep Research can also call MCP tools — give it permission to use the RRM Academy
connector when you ask an RRM-related question.

### Perplexity — Pro

1. Open perplexity.ai (web or Mac app).
2. Profile icon (bottom-left) → Settings.
3. Connectors → + Add → Remote.
4. Fill in: Name `RRM Academy`, MCP Server URL `https://mcp.rrmacademy.org/mcp`, Transport Streamable HTTP, Auth API Key (paste your key).
5. Save. A green checkmark means you're connected.

## The five tools

Once connected, your AI gains these capabilities. Ask in natural language — the
AI picks the right tool.

- `search` — thousands of peer-reviewed articles on RRM, NaProTechnology, FABMs, endometriosis, PCOS, and women's health. Filter by author, year, type, or tradition.
- `get_article` — full details on a specific article: abstract, citation, journal, year, RRM relevance score.
- `find_related` — articles related to one you've found, via citations and shared topics.
- `check_guardrails` — validate a draft against RRM editorial standards. Run before publishing anything written about RRM topics.
- `check_facts` — verify pregnancy rates, success percentages, and prevalence figures against the curated facts database.

## For developers

Calling the MCP server programmatically — your own backend, a script, an agent
framework. Use the official SDKs when you can; they handle the JSON-RPC envelope,
transport, and reconnection for you.

- https://rrmacademy.org/openapi/ — OpenAPI 3.1 spec rendered as readable docs.
- https://rrmacademy.org/openapi.json — Raw spec for tooling (Postman, Insomnia, code generators).
- https://mcp.rrmacademy.org/.well-known/mcp/server-card.json — Machine-readable tool list with full input schemas.
- https://rrmacademy.org/library/rss.xml — Recent additions to the research library.
- https://rrmacademy.org/commentary/rss.xml — Recent clinical commentary posts.

### Quick start (curl)

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

See https://rrmacademy.org/agent-auth/ for Python and Node.js samples plus the
full request/response schemas.

## Privacy & logging

- **What we log:** every tool call gets a timestamp, the tool name, the response status, and a label identifying which API key was used. No prompt content beyond what's required to fulfill the search.
- **What stays private:** your AI conversations live with your AI provider (Anthropic, OpenAI, Perplexity). RRM Academy only sees the specific search query or fact-check text routed through a tool — never the surrounding chat.
- **Revoking access:** revoke a key from your account. Takes effect immediately; other keys keep working.

## More

- https://mcp.rrmacademy.org/.well-known/mcp/server-card.json — full machine-readable tool list.
- https://rrmacademy.org/.well-known/mcp.json — server metadata for agent discovery.
- https://rrmacademy.org/llms.txt — site map for AI crawlers.
- Setup help: info@rrmacademy.org

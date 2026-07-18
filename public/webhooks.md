# Webhooks & Subscription Channels

Markdown twin of https://rrmacademy.org/webhooks/

How AI agents, ingestion pipelines, and downstream apps subscribe to new RRM
Academy research library articles, commentary posts, and curated facts.

## Outbound webhooks status

**RRM Academy does not currently expose outbound HTTP webhooks.** Instead,
content subscription is offered through three pull-based channels that are
simpler to integrate, easier to retry, and friendlier to AI agents that already
know how to read RSS or call an MCP server.

If your use case genuinely requires push-based delivery (for example: a managed
indexing pipeline you cannot poll), email info@rrmacademy.org with the spec. We
will scope an outbound webhook surface if there is real demand.

## Supported subscription channels

Pick the channel that matches your agent or pipeline. All three are free and
unauthenticated for read access.

- **Library RSS** — https://rrmacademy.org/library/rss.xml — RFC 4287 Atom feed of every new research library article. Updated within minutes of publication. No API key required.
- **Commentary RSS** — https://rrmacademy.org/commentary/rss.xml — Atom feed of every new clinical commentary post. No API key required.
- **MCP server** — https://rrmacademy.org/connect/ — Pull updates programmatically via the `search` tool with a date filter. Requires a free Bearer API token.

## Recommended polling pattern

For agents and indexers, poll the RSS feeds every 15 minutes. Use the
`If-Modified-Since` request header to skip work when the feed has not changed.

```
curl -s -H "If-Modified-Since: Wed, 21 May 2026 09:00:00 GMT" \
  https://rrmacademy.org/library/rss.xml
```

A `304 Not Modified` response means no new articles. A `200 OK` returns the full
Atom feed; diff against your last-seen entry IDs.

## Why pull, not push

- **Reliability** — Pull-based delivery makes the consumer responsible for retries. No dead-letter queues, no signature verification, no replay windows to manage.
- **Authentication simplicity** — RSS needs none. MCP needs only a Bearer API token. Outbound webhooks require shared-secret signing on both sides.
- **Lower latency in practice** — Agents querying the MCP `search` tool get sub-second results at the moment of need, not delayed batch deliveries.
- **Editorial coherence** — The library publishes after editorial review, not at content-creation time. A push-on-create webhook would fire on drafts.

## Related developer pages

- https://rrmacademy.org/agent-auth/ — Step-by-step API token authentication guide.
- https://rrmacademy.org/connect/ — Per-client MCP setup guide.
- https://rrmacademy.org/openapi/ — API documentation (OpenAPI 3.1).
- https://rrmacademy.org/llms.txt — Site index for AI crawlers.
- Spec request: info@rrmacademy.org

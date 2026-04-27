# Envelope MCP

Envelope exposes a remote Model Context Protocol endpoint at `/mcp` when `ENVELOPE_MCP_ENABLED=true` (enabled by default).

Configure MCP clients with Streamable HTTP and an Envelope API key:

```json
{
  "mcpServers": {
    "envelope": {
      "type": "streamable-http",
      "url": "https://your-envelope.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <envelope-api-key>"
      }
    }
  }
}
```

Read tools run immediately and enforce the same API-key scopes used by the REST API. Write tools create approval requests instead of mutating data directly. Review requests in the web UI at **Admin -> MCP**.

Approval payloads are encrypted at rest with the Envelope master key. The admin UI displays sanitized arguments with secret values redacted. Approved requests execute with the original requester API key, so scope checks are still enforced at execution time.

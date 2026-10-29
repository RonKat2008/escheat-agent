# Escheat Agent MCP server

Lets Claude (Claude Code, Claude Desktop, any MCP client) answer unclaimed-property questions from the same read-model the dashboard uses.
Prototype. Not legal advice. Confirm filings with a qualified professional. Every tool response repeats this line and flags UNVERIFIED rules.

## Tools

| Tool | Kind | Use |
|---|---|---|
| `get_exposure(state?)` | read | "What do we owe, and where?" Total, count, by state / status / property type |
| `list_stale_items(filters)` | read | Drill-down: payee, check #, amount, age, owner state, status, next deadline |
| `upcoming_deadlines(days=90)` | read | Due-diligence, report and remit deadlines in the window |
| `explain_item(id_or_check_number)` | read | Full timeline per date: rule path, version, sources (URL/quote), verified flag, outreach, approvals, agent runs |
| `get_audit_interest_exposure()` | read | Per-state interest ESTIMATE; "Estimate; rule unverified" when applicable |
| `create_outreach_draft(item_id)` | write (draft only) | Creates/returns a letter draft row (`status=draft`). Never sends. A human approves in the app at `/approvals` |

## Add to Claude Code

stdio (uses the local database, `.data/pglite` unless `DATABASE_URL` is set):

```bash
claude mcp add escheat -- pnpm --dir /Users/you/escheat-agent mcp:stdio
# with a Neon database:
claude mcp add escheat --env DATABASE_URL=postgres://... -- pnpm --dir /Users/you/escheat-agent mcp:stdio
```

HTTP (the Next app must be running; set `MCP_TOKEN` in `.env.local`):

```bash
claude mcp add --transport http escheat http://localhost:3000/api/mcp --header "Authorization: Bearer $MCP_TOKEN"
claude mcp list
```

Project `.mcp.json` equivalent:

```json
{ "mcpServers": { "escheat": { "type": "http", "url": "http://localhost:3000/api/mcp", "headers": { "Authorization": "Bearer ${MCP_TOKEN}" } } } }
```

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "escheat": {
      "command": "pnpm",
      "args": ["--dir", "/Users/you/escheat-agent", "mcp:stdio"]
    }
  }
}
```

HTTP via the `mcp-remote` bridge (UNVERIFIED against the current Desktop release):

```json
{ "mcpServers": { "escheat-http": { "command": "npx", "args": ["-y", "mcp-remote", "http://localhost:3000/api/mcp", "--header", "Authorization: Bearer ${MCP_TOKEN}"], "env": { "MCP_TOKEN": "..." } } } }
```

## HTTP endpoint behavior

`POST /api/mcp` (Streamable HTTP, stateless, JSON responses). `Authorization: Bearer $MCP_TOKEN` is required.
`MCP_TOKEN` unset => `503 MCP_TOKEN not configured` (allowed with a console warning only when `NODE_ENV=development`). Wrong or missing token => `401`.

## Notes

- PGlite is single-process: do not run `pnpm mcp:stdio` and `next dev` against the same `.data/pglite` at the same time. Use `DATABASE_URL` (Neon) to share one database, or stop the app first.
- stdio logs go to stderr only; stdout is the protocol.
- "Today" follows the app's demo clock (`DEMO_ANCHOR_DATE` + simulated offset).

## Demo

Ask: **"What do we owe in unclaimed property, and where?"**

Expected tool call: `get_exposure` with `{}`. Expected answer shape: total and item count (47 items / $61,915.00 at the demo anchor date),
split by owner state (CA 21, TX 15, DE 11), with a note that figures depending on UNVERIFIED rules are provisional.
Follow-ups map to `explain_item({"id_or_check_number":"10482"})`, `upcoming_deadlines({"days":90})`, and `create_outreach_draft({"item_id":"10482"})` (draft only, needs approval in the app).

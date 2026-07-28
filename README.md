# ckeditor-mcp

**A [Model Context Protocol](https://modelcontextprotocol.io) server that lets any AI agent operate a real CKEditor 5 instance — built for server-side content workflows.**

Automation pipelines, document-processing jobs, and interactive agents alike: point Claude, Cursor, or any MCP client at this server and it can read the document, set and insert HTML, run any editor command, inspect the command surface, count words, and screenshot the rendered result — driving the *same* editor APIs a human user's clicks would. Content work that used to require a human in a browser tab becomes an agent-callable tool surface, with the genuine editor engine (schema, commands, premium features, licensing) underneath.

```
┌─────────────┐   MCP (stdio / HTTP)   ┌───────────────┐   Playwright   ┌────────────────────┐
│  AI agent   │ ─────────────────────▶ │  ckeditor-mcp │ ─────────────▶ │  headless Chromium │
│ (Claude…)   │ ◀───────────────────── │    server     │ ◀───────────── │  + real CKEditor 5 │
└─────────────┘      tool calls        └───────────────┘   page.evaluate└────────────────────┘
```

## Why this exists

CKEditor's own AI integration is an MCP **client**: the editor's in-app agent reaches *out* to external MCP servers to fetch context and call tools ([CKEditor: *How we built MCP support in CKEditor AI*](https://ckeditor.com/blog/how-we-built-mcp-support-in-ckeditor-ai/)).

`ckeditor-mcp` inverts that relationship. It is an MCP **server** that exposes CKEditor's document operations *as* tools, so any MCP-compatible assistant can drive a CKEditor instance from the outside.

> CKEditor built: **editor → (as client) → external tools.**
> This builds: **any agent → (over MCP) → drives the editor.**

To our knowledge no existing npm package or public repository provides a CKEditor MCP server (checked npm + GitHub, July 2026). The two directions are complementary — together they let an editor call out to the world *and* let the world drive the editor.

## How it works

The server boots a headless Chromium page (via Playwright) that loads CKEditor 5 from the official CDN using your license key. Each MCP tool is a thin bridge into the live editor through `page.evaluate` — e.g. `ckeditor-execute-command` calls `editor.execute(name, value)`, `ckeditor-get-content` calls `editor.getData()`. Nothing is reimplemented or mocked; the agent operates the genuine editor engine, premium features included.

The browser boots **lazily** on the first tool call and is shared for the process lifetime.

## Quick start

```bash
git clone https://github.com/krystiangw/ckeditor-mcp.git
cd ckeditor-mcp
npm install
npx playwright install chromium
cp .env.example .env      # then paste your CKEditor license key
npm run build
```

Get a free 14-day trial license key (unlocks all premium features) at [portal.ckeditor.com](https://portal.ckeditor.com/). Without a key the server runs on CKEditor's open-source (GPL) feature set — served from the local npm package rather than the CDN, because CKEditor's CDN is a commercial distribution channel and boots read-only under a `GPL` key.

Prove it works end to end:

```bash
npm run smoke
```

```
[1/2] direct EditorSession API
  ✓ editor v48.3.1 booted (licensed=true, premium=true [FormatPainter, CaseChange])
  ✓ set-content round-trips HTML
  ✓ insert-html appends at end
  ✓ execute-command ran (heading -> "heading3")
  ✓ list-commands returned 100 commands
  ✓ stats: 4 words / 36 chars
  ✓ screenshot captured
[2/2] MCP client over in-memory transport
  ✓ tools/list -> ckeditor-get-content, ckeditor-set-content, …
  ✓ called ckeditor-set-content + ckeditor-get-content through MCP
✅ smoke passed
```

## Connect an MCP client

Ready-made client config and a sample agent session are in [`examples/`](./examples).

### Claude Desktop / Cursor (stdio)

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ckeditor": {
      "command": "node",
      "args": ["/absolute/path/to/ckeditor-mcp/dist/index.js"],
      "env": { "CKEDITOR_LICENSE_KEY": "your-license-key" }
    }
  }
}
```

### Streamable HTTP

```bash
npm start -- --http 3000       # POST http://127.0.0.1:3000/mcp
```

Streamable HTTP is the same transport CKEditor chose for their MCP client — a single HTTP endpoint that plays well with proxies and load balancers.

## Tools

| Tool | Description |
|------|-------------|
| `ckeditor-get-content` | Return the document's full HTML. |
| `ckeditor-set-content` | Replace the whole document with given HTML; returns the normalized result. |
| `ckeditor-insert-html` | Insert an HTML fragment at the selection / start / end without clearing. |
| `ckeditor-execute-command` | Run any editor command (`bold`, `heading`, `insertTable`, `link`, …) with an optional value. |
| `ckeditor-list-commands` | List every command with its enabled state and current value — discovery for the above. |
| `ckeditor-get-stats` | Word and character count. |
| `ckeditor-screenshot` | PNG of the rendered editor so the agent can *see* the document. |
| `ckeditor-info` | Loaded version, license status, and available premium features. |

The `execute-command` + `list-commands` pair is deliberately generic: it exposes CKEditor's entire command surface (100+ commands in the default premium build) rather than hard-coding a fixed menu, so the agent can do anything the editor can.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `CKEDITOR_LICENSE_KEY` | `GPL` | License key. `GPL` = open-source features only. |
| `CKEDITOR_VERSION` | `48.3.1` | CKEditor 5 version loaded from the CDN. |
| `CKEDITOR_HEADLESS` | `true` | Set `false` to watch the editor in a real window while debugging. |
| `CKEDITOR_CS_ENVIRONMENT_ID` | — | Cloud Services env ID (only for the roadmap export/import tools). |
| `CKEDITOR_CS_ACCESS_KEY` | — | Cloud Services access key (only for the roadmap export/import tools). |

## Roadmap

- **Export to PDF / Word, Import from Word.** CKEditor's converters run in the cloud and authenticate with *Cloud Services* credentials (environment ID + access key), which are separate from the editor license key. These tools will activate automatically when `CKEDITOR_CS_*` are set, and report as unavailable otherwise.
- **AI tools** (`AIChat`, `AIQuickActions`, `AIReview`) — CKEditor's hosted AI service is driven by the license key, a natural fit for an `ckeditor-ai` tool.
- **Suggestions mode — governed agent editing.** Agent edits materialized as Track Changes
  suggestions instead of direct mutations, so a human accepts or rejects each change.
  A working end-to-end version of this pattern (external agent → leased plan queue →
  suggestions in the human's editor) ships in the companion demo,
  [ckeditor-agent-demo](https://github.com/krystiangw/ckeditor-agent-demo).
- **Collaboration** — comments, suggestions, and track-changes state as first-class tools.
- **Multiple documents / sessions** per server, plus a hardened hosted deployment of the
  Streamable HTTP transport (auth, per-session browser contexts, limits).

## Design notes

- **Version pin:** built on `@modelcontextprotocol/sdk` 1.29.x (the current stable line). The SDK's v2 split (`@modelcontextprotocol/server`) lands with the 2026-07-28 spec revision; the high-level `McpServer` API used here is stable across that transition.
- **Errors** are returned as MCP tool errors (`isError: true`) with a readable message, never thrown across the transport.
- **Secrets:** license/API keys come from the environment; `.env` is gitignored.

## License

MIT © Krystian Gwizdała. Not affiliated with or endorsed by CKSource / CKEditor.

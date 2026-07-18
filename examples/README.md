# Examples

## 1. Connect from Claude Desktop / Cursor

See [`claude-desktop-config.json`](./claude-desktop-config.json). After `npm run build`, drop the
`mcpServers` block into your client config (adjust the absolute path + license key) and restart the client.
The `ckeditor` server then appears with its eight tools.

## 2. A sample agent session

Once connected, an assistant can build a document end to end. A natural tool sequence:

```
1. ckeditor-set-content   { "html": "<h1>Q3 Release Notes</h1>" }
2. ckeditor-insert-html   { "html": "<h2>Highlights</h2><ul><li>Faster export</li><li>New AI actions</li></ul>", "position": "end" }
3. ckeditor-execute-command { "command": "insertTable", "value": { "rows": 3, "columns": 2 } }
4. ckeditor-list-commands   {}                      # discover what else is possible
5. ckeditor-get-stats       {}                      # -> { "words": 12, "characters": 78 }
6. ckeditor-screenshot      {}                      # -> PNG the agent can visually verify
7. ckeditor-get-content     {}                      # -> final HTML to hand back to the user
```

The agent never has to know CKEditor's API up front: `ckeditor-list-commands` returns the full,
live command surface (100+ commands in the premium build) with each command's enabled state, so the
model can discover capabilities at runtime and then drive them with `ckeditor-execute-command`.

## 3. Drive it programmatically

The repo's own [`scripts/smoke.ts`](../scripts/smoke.ts) is a runnable example: it boots the editor,
exercises every operation directly, and then drives the same server through an MCP client over an
in-memory transport. Run it with `npm run smoke`.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Connects a server over stdio — the transport local MCP clients spawn. */
export async function startStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep stderr for logs; stdout is the JSON-RPC channel and must stay clean.
  console.error('[ckeditor-mcp] stdio transport ready');
}

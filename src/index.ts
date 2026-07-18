#!/usr/bin/env node
/**
 * ckeditor-mcp entrypoint.
 *
 *   ckeditor-mcp            # stdio transport (default; for Claude Desktop, Cursor, etc.)
 *   ckeditor-mcp --http     # Streamable HTTP transport on PORT (default 3000)
 *
 * A single headless CKEditor session is shared across the process; over HTTP a
 * fresh MCP server is created per request but bound to that shared session.
 */
import { createSession, getServer } from './server.js';
import { startStdio } from './transports/stdio.js';
import { startHttp } from './transports/http.js';

async function main(): Promise<void> {
  const useHttp = process.argv.includes('--http');
  const session = createSession();

  const shutdown = async () => {
    await session.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (useHttp) {
    const portArg = process.argv[process.argv.indexOf('--http') + 1];
    const port = portArg && /^\d+$/.test(portArg) ? Number(portArg) : Number(process.env.PORT) || 3000;
    await startHttp(session, port);
  } else {
    await startStdio(getServer(session));
  }
}

main().catch((err) => {
  console.error('[ckeditor-mcp] fatal:', err);
  process.exit(1);
});

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getServer } from '../server.js';
import type { EditorSession } from '../editor/session.js';

/**
 * Serves the MCP server over Streamable HTTP (stateless): a fresh MCP server is
 * created per request but bound to the shared, long-lived editor session so the
 * headless browser is booted only once. Mirrors the transport CKEditor's own
 * MCP client uses (see README).
 */
export async function startHttp(session: EditorSession, port: number): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.post('/mcp', async (req, res) => {
    try {
      const server = getServer(session);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[ckeditor-mcp] http error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Streamable HTTP GET/DELETE are unused in stateless mode.
  const methodNotAllowed = (_req: express.Request, res: express.Response) =>
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  await new Promise<void>((resolve) => app.listen(port, '127.0.0.1', resolve));
  console.error(`[ckeditor-mcp] Streamable HTTP transport ready on http://127.0.0.1:${port}/mcp`);
}

/**
 * Builds the MCP server and registers the CKEditor tools. Every tool is a thin
 * wrapper over a shared {@link EditorSession}; the session boots lazily on the
 * first tool call, so `getServer()` is cheap and side-effect free.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { EditorSession } from './editor/session.js';

const pkg = { name: 'ckeditor-mcp', version: '0.1.0' };

type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/** Wraps a tool body so any thrown error becomes an MCP error result. */
function guard<T extends unknown[]>(fn: (...args: T) => Promise<{ content: ToolContent[] }>) {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
    }
  };
}

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] };
}

export function getServer(session: EditorSession): McpServer {
  const server = new McpServer(pkg);

  server.registerTool(
    'ckeditor-get-content',
    {
      title: 'Get document content',
      description:
        'Return the full HTML content of the CKEditor document. Use this to read the current state before editing.',
      inputSchema: {},
    },
    guard(async () => text(await session.getContent())),
  );

  server.registerTool(
    'ckeditor-set-content',
    {
      title: 'Replace document content',
      description:
        'Replace the entire document with the provided HTML. Returns the normalized HTML as stored by the editor. Overwrites everything — use ckeditor-insert-html to add content instead.',
      inputSchema: { html: z.string().describe('The full HTML document body to load into the editor.') },
    },
    guard(async ({ html }) => text(await session.setContent(html))),
  );

  server.registerTool(
    'ckeditor-insert-html',
    {
      title: 'Insert HTML',
      description:
        'Parse an HTML fragment and insert it into the document without clearing existing content. Position controls where: at the current selection, the start, or the end of the document.',
      inputSchema: {
        html: z.string().describe('HTML fragment to insert (e.g. "<h2>Title</h2><p>Body</p>").'),
        position: z
          .enum(['selection', 'start', 'end'])
          .default('end')
          .describe('Where to insert. Defaults to the end of the document.'),
      },
    },
    guard(async ({ html, position }) => text(await session.insertHtml(html, position))),
  );

  server.registerTool(
    'ckeditor-execute-command',
    {
      title: 'Execute an editor command',
      description:
        'Execute any CKEditor command against the current selection, e.g. "bold", "heading" (value {"value":"heading2"}), "insertTable" (value {"rows":2,"columns":3}), "link" (value "https://..."). Use ckeditor-list-commands to discover available commands and their enabled state.',
      inputSchema: {
        command: z.string().describe('The command name, e.g. "bold", "heading", "insertTable".'),
        value: z
          .any()
          .optional()
          .describe('Optional command argument. Shape depends on the command (string, object, etc.).'),
      },
    },
    guard(async ({ command, value }) => {
      const info = await session.execute(command, value);
      return text(JSON.stringify(info));
    }),
  );

  server.registerTool(
    'ckeditor-list-commands',
    {
      title: 'List editor commands',
      description:
        'List every command the editor exposes, with its current enabled state and value. Use this to discover what operations are possible before calling ckeditor-execute-command.',
      inputSchema: {},
    },
    guard(async () => {
      const commands = await session.listCommands();
      return text(JSON.stringify(commands, null, 2));
    }),
  );

  server.registerTool(
    'ckeditor-get-stats',
    {
      title: 'Get document statistics',
      description: 'Return the word and character count of the current document.',
      inputSchema: {},
    },
    guard(async () => {
      const stats = await session.getStats();
      return text(JSON.stringify(stats));
    }),
  );

  server.registerTool(
    'ckeditor-screenshot',
    {
      title: 'Screenshot the editor',
      description:
        'Render the current editor content to a PNG image so the agent can visually inspect the document layout.',
      inputSchema: {},
    },
    guard(async () => {
      const png = await session.screenshot();
      return {
        content: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }],
      };
    }),
  );

  server.registerTool(
    'ckeditor-info',
    {
      title: 'Editor session info',
      description:
        'Report the loaded CKEditor version, whether a commercial/trial license is active, and which premium features are available.',
      inputSchema: {},
    },
    guard(async () => text(JSON.stringify(await session.info(), null, 2))),
  );

  return server;
}

export function createSession(): EditorSession {
  return new EditorSession(loadConfig());
}

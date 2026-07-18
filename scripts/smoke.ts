/**
 * End-to-end smoke test — no test framework, just runnable proof that:
 *   1. the headless CKEditor session boots and its editing API works, and
 *   2. an MCP client can drive it over an in-memory transport.
 *
 * Run: npm run smoke
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSession, getServer } from '../src/server.js';

function ok(label: string) {
  console.log(`  ✓ ${label}`);
}

async function main() {
  const session = createSession();

  console.log('\n[1/2] direct EditorSession API');
  const info = await session.info();
  ok(`editor v${info.version} booted (licensed=${info.licensed}, premium=${info.premium} [${info.premiumPlugins.join(', ')}])`);

  await session.setContent('<h2>Report</h2><p>First paragraph.</p>');
  let html = await session.getContent();
  assert.match(html, /<h2>Report<\/h2>/);
  ok('set-content round-trips HTML');

  await session.insertHtml('<p>Appended line.</p>', 'end');
  html = await session.getContent();
  assert.match(html, /Appended line/);
  ok('insert-html appends at end');

  const cmd = await session.execute('heading', { value: 'heading3' });
  ok(`execute-command ran (heading -> ${JSON.stringify(cmd.value)})`);

  const commands = await session.listCommands();
  assert.ok(commands.some((c) => c.name === 'bold'));
  ok(`list-commands returned ${commands.length} commands`);

  const stats = await session.getStats();
  assert.ok(stats.characters > 0);
  ok(`stats: ${stats.words} words / ${stats.characters} chars`);

  const png = await session.screenshot();
  assert.ok(png.length > 100);
  await writeFile('/tmp/ckeditor-mcp-smoke.png', png);
  ok(`screenshot captured (${png.length} bytes -> /tmp/ckeditor-mcp-smoke.png)`);

  console.log('\n[2/2] MCP client over in-memory transport');
  const server = getServer(session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'smoke-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const tools = await client.listTools();
  ok(`tools/list -> ${tools.tools.map((t) => t.name).join(', ')}`);

  await client.callTool({ name: 'ckeditor-set-content', arguments: { html: '<p>Via MCP.</p>' } });
  const getRes = (await client.callTool({ name: 'ckeditor-get-content', arguments: {} })) as {
    content: { type: string; text: string }[];
  };
  assert.match(getRes.content[0].text, /Via MCP/);
  ok('called ckeditor-set-content + ckeditor-get-content through MCP');

  await client.close();
  await session.close();
  console.log('\n✅ smoke passed\n');
}

main().catch((err) => {
  console.error('\n❌ smoke failed:', err);
  process.exit(1);
});

// Throwaway spike: prove CKEditor 5 (premium) loads in headless Chromium and
// responds to editor API calls (getData / execute / insertContent).
// Usage: TRIAL_KEY loaded from ../../personalny/.env
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read the license key from CKEDITOR_LICENSE_KEY or the repo-root .env, without printing it.
async function loadKey() {
  if (process.env.CKEDITOR_LICENSE_KEY) return process.env.CKEDITOR_LICENSE_KEY.trim();
  try {
    const env = await readFile(join(__dirname, '..', '.env'), 'utf8');
    const m = env.match(/^CKEDITOR_LICENSE_KEY=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

const key = await loadKey();
console.log('license key loaded:', key ? `yes (len ${key.length})` : 'NO — falling back to GPL');

// Minimal static server for the spike dir.
const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = await readFile(join(__dirname, path));
    const type = path.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const url = `http://localhost:${port}/index.html`;
console.log('serving spike at', url);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

if (key) await page.addInitScript((k) => { window.CK_LICENSE = k; }, key);

await page.goto(url, { waitUntil: 'networkidle' });

// Wait until the editor is ready or errored (max 30s).
await page.waitForFunction(() => window.__spike && (window.__spike.ready || window.__spike.error), null, { timeout: 30000 })
  .catch(() => {});

const spike = await page.evaluate(() => window.__spike);
console.log('\n=== spike state ===');
console.log(JSON.stringify(spike, null, 2));

if (spike && spike.ready) {
  const result = await page.evaluate(() => {
    const ed = window.__editor;
    const before = ed.getData();
    ed.setData('<h2>Automated heading</h2><p>Set via API.</p>');
    const commands = [...ed.commands.names()].sort();
    // execute a command: bold on a selection
    ed.model.change((writer) => {
      writer.setSelection(ed.model.document.getRoot().getChild(1), 'in');
    });
    ed.execute('bold');
    // insert content at selection
    const vf = ed.data.processor.toView('<p><strong>Inserted</strong> via insertContent.</p>');
    const mf = ed.data.toModel(vf);
    ed.model.insertContent(mf);
    const after = ed.getData();
    return {
      before,
      after,
      commandCount: commands.length,
      hasBold: commands.includes('bold'),
      hasFormatPainter: commands.includes('formatPainter'),
      sampleCommands: commands.slice(0, 40)
    };
  });
  console.log('\n=== API test ===');
  console.log(JSON.stringify(result, null, 2));
}

await browser.close();
server.close();
console.log('\nspike done.');

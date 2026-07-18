/**
 * EditorSession — hosts a real CKEditor 5 instance in a headless Chromium page
 * and exposes its editing API to the Node process. Every operation is a thin
 * bridge into the live editor via `page.evaluate`, so the agent drives the same
 * code path a human user would.
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { Config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export interface CommandInfo {
  name: string;
  isEnabled: boolean;
  value: unknown;
}

export interface EditorStats {
  words: number;
  characters: number;
}

export interface SessionInfo {
  version: string;
  licensed: boolean;
  premium: boolean;
  premiumPlugins: string[];
}

export class EditorSession {
  private browser?: Browser;
  private page?: Page;
  private httpServer?: Server;
  private ready = false;
  private initPromise?: Promise<void>;

  constructor(private readonly config: Config) {}

  /** Lazily boots the browser + editor on first use. Safe to call repeatedly. */
  async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (!this.initPromise) {
      // On a transient failure (Chromium launch, CDN hiccup), tear down any
      // partial state and clear the cached promise so a later call can retry.
      this.initPromise = this.init().catch(async (err) => {
        await this.close();
        throw err;
      });
    }
    await this.initPromise;
  }

  private async init(): Promise<void> {
    const html = await this.buildPage();

    // Under GPL the editor is served from the local npm package: the CKEditor
    // CDN is a commercial distribution channel and boots read-only with a
    // 'GPL' key. Self-hosting is the GPL-compliant channel.
    const vendorDir = this.isGpl
      ? join(dirname(require.resolve('ckeditor5/package.json')), 'dist', 'browser')
      : null;

    this.httpServer = createServer(async (req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      if (vendorDir && path.startsWith('/vendor/')) {
        const name = path.slice('/vendor/'.length);
        if (!/^[\w.-]+$/.test(name)) {
          res.writeHead(400);
          return res.end('bad request');
        }
        try {
          const body = await readFile(join(vendorDir, name));
          const type = name.endsWith('.css') ? 'text/css' : 'text/javascript';
          res.writeHead(200, { 'content-type': type });
          return res.end(body);
        } catch {
          res.writeHead(404);
          return res.end('not found');
        }
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    await new Promise<void>((r) => this.httpServer!.listen(0, '127.0.0.1', r));
    const address = this.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('failed to bind host server');
    const url = `http://127.0.0.1:${address.port}/`;

    this.browser = await chromium.launch({ headless: this.config.headless });
    this.page = await this.browser.newPage();
    await this.page.addInitScript((key) => {
      (window as unknown as Record<string, unknown>).__CKE_LICENSE__ = key;
    }, this.config.licenseKey);

    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page.waitForFunction(
      () => {
        const ck = (window as unknown as { __ck?: { ready: boolean; error: string | null } }).__ck;
        return !!ck && (ck.ready || !!ck.error);
      },
      { timeout: 45_000 },
    );

    const state = await this.page.evaluate(
      () => (window as unknown as { __ck: { ready: boolean; error: string | null } }).__ck,
    );
    if (!state.ready) {
      throw new Error(`CKEditor failed to initialize: ${state.error ?? 'unknown error'}`);
    }
    this.ready = true;
  }

  private get isGpl(): boolean {
    return this.config.licenseKey === 'GPL';
  }

  /**
   * Reads the hosted page template and pins the configured CKEditor version.
   * Under GPL, CDN URLs are rewritten to the locally served npm build and the
   * premium bundle (commercial-only) is stripped entirely.
   */
  private async buildPage(): Promise<string> {
    const template = await readFile(join(__dirname, 'page.html'), 'utf8');
    const pinned = template.replace(/48\.3\.1/g, this.config.version);
    if (!this.isGpl) return pinned;
    return pinned
      .split('\n')
      .filter((line) => !line.includes('ckeditor5-premium-features'))
      .join('\n')
      .replace(/https:\/\/cdn\.ckeditor\.com\/ckeditor5\/[\d.]+\/ckeditor5\.css/g, '/vendor/ckeditor5.css')
      .replace(/https:\/\/cdn\.ckeditor\.com\/ckeditor5\/[\d.]+\/ckeditor5\.umd\.js/g, '/vendor/ckeditor5.umd.js');
  }

  private get editorPage(): Page {
    if (!this.page || !this.ready) throw new Error('editor session is not ready');
    return this.page;
  }

  // --- Editing operations -------------------------------------------------

  async getContent(): Promise<string> {
    await this.ensureReady();
    return this.editorPage.evaluate(
      () => (window as unknown as { __editor: { getData(): string } }).__editor.getData(),
    );
  }

  async setContent(html: string): Promise<string> {
    await this.ensureReady();
    return this.editorPage.evaluate((data) => {
      const ed = (window as unknown as { __editor: { setData(h: string): void; getData(): string } }).__editor;
      ed.setData(data);
      return ed.getData();
    }, html);
  }

  async insertHtml(html: string, position: 'selection' | 'start' | 'end'): Promise<string> {
    await this.ensureReady();
    return this.editorPage.evaluate(
      ({ data, pos }) => {
        const ed = (window as unknown as { __editor: any }).__editor;
        ed.model.change((writer: any) => {
          const root = ed.model.document.getRoot();
          if (pos === 'end') writer.setSelection(root, 'end');
          else if (pos === 'start') writer.setSelection(root, 'start');
        });
        const viewFragment = ed.data.processor.toView(data);
        const modelFragment = ed.data.toModel(viewFragment);
        ed.model.insertContent(modelFragment);
        return ed.getData();
      },
      { data: html, pos: position },
    );
  }

  async execute(command: string, value?: unknown): Promise<CommandInfo> {
    await this.ensureReady();
    return this.editorPage.evaluate(
      ({ name, val }) => {
        const ed = (window as unknown as { __editor: any }).__editor;
        const cmd = ed.commands.get(name);
        if (!cmd) throw new Error(`unknown command: ${name}`);
        if (!cmd.isEnabled) throw new Error(`command "${name}" is not enabled for the current selection/state`);
        ed.execute(name, val);
        const after = ed.commands.get(name);
        return { name, isEnabled: !!after.isEnabled, value: after.value ?? null };
      },
      { name: command, val: value ?? undefined },
    );
  }

  async listCommands(): Promise<CommandInfo[]> {
    await this.ensureReady();
    return this.editorPage.evaluate(() => {
      const ed = (window as unknown as { __editor: any }).__editor;
      const out: { name: string; isEnabled: boolean; value: unknown }[] = [];
      for (const name of ed.commands.names()) {
        const cmd = ed.commands.get(name);
        out.push({ name, isEnabled: !!cmd.isEnabled, value: cmd.value ?? null });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async getStats(): Promise<EditorStats> {
    await this.ensureReady();
    return this.editorPage.evaluate(() => {
      const ed = (window as unknown as { __editor: any }).__editor;
      const wc = ed.plugins.has('WordCount') ? ed.plugins.get('WordCount') : null;
      return { words: wc ? wc.words : 0, characters: wc ? wc.characters : 0 };
    });
  }

  async screenshot(): Promise<Buffer> {
    await this.ensureReady();
    const locator = this.editorPage.locator('.ck-editor__editable').first();
    return locator.screenshot({ type: 'png' });
  }

  async info(): Promise<SessionInfo> {
    await this.ensureReady();
    const ck = await this.editorPage.evaluate(
      () => (window as unknown as { __ck: { premium: boolean; premiumPlugins: string[] } }).__ck,
    );
    return {
      version: this.config.version,
      licensed: this.config.licenseKey !== 'GPL',
      premium: ck.premium,
      premiumPlugins: ck.premiumPlugins ?? [],
    };
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.httpServer?.close();
    this.ready = false;
    this.browser = undefined;
    this.page = undefined;
    this.httpServer = undefined;
    this.initPromise = undefined;
  }
}

/**
 * Runtime configuration, resolved from environment variables.
 * A `.env` file (see `.env.example`) is loaded automatically if present.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      if (process.env[key] === undefined) {
        process.env[key] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // No .env file — rely on the ambient environment.
  }
}

loadDotEnv();

export interface Config {
  /** CKEditor 5 license key. Falls back to 'GPL' (open-source features only). */
  licenseKey: string;
  /** CKEditor 5 version to load from the CDN. */
  version: string;
  /** Run the hosted browser headless (default true). */
  headless: boolean;
  /**
   * Optional CKEditor Cloud Services credentials, required only for the
   * export/import converter tools. Absent → those tools report as unavailable.
   */
  cloudServices?: {
    environmentId: string;
    accessKey: string;
  };
}

export function loadConfig(): Config {
  const environmentId = process.env.CKEDITOR_CS_ENVIRONMENT_ID;
  const accessKey = process.env.CKEDITOR_CS_ACCESS_KEY;

  return {
    licenseKey: process.env.CKEDITOR_LICENSE_KEY?.trim() || 'GPL',
    version: process.env.CKEDITOR_VERSION?.trim() || '48.3.1',
    headless: process.env.CKEDITOR_HEADLESS !== 'false',
    cloudServices:
      environmentId && accessKey ? { environmentId, accessKey } : undefined,
  };
}

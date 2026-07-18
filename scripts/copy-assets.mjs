// Copies non-TS runtime assets (the hosted editor page) into dist/ after tsc.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'src/editor/page.html');
const to = resolve(root, 'dist/editor/page.html');

await mkdir(dirname(to), { recursive: true });
await copyFile(from, to);
console.log('copied page.html -> dist/editor/page.html');

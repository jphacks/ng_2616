// Copies pdf.js (main module + worker) to public/pdfjs/ so it loads at runtime, unbundled.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve('pdfjs-dist/package.json'));
const out = join(here, '..', 'public', 'pdfjs');
mkdirSync(out, { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) copyFileSync(join(pkg, 'build', f), join(out, f));
console.log(`pdf.js -> ${out}`);

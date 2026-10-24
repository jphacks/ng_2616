// Copies the CAS Python package to frontend/public/cas/cas_core/ with a manifest the worker reads.
// Runs before `next dev` / `next build`; the output is git-ignored.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'cas_core');
const out = join(here, '..', '..', 'frontend', 'public', 'cas', 'cas_core');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const hash = createHash('sha256');
const files = readdirSync(src).filter((f) => f.endsWith('.py')).sort();
for (const f of files) {
  const text = readFileSync(join(src, f), 'utf8');
  hash.update(f).update(text);
  writeFileSync(join(out, f), text);
}

const init = readFileSync(join(src, '__init__.py'), 'utf8');
const rulesVersion = /RULES_VERSION\s*=\s*"([^"]+)"/.exec(init)?.[1] ?? 'unknown';
const manifest = { rules_version: rulesVersion, digest: hash.digest('hex').slice(0, 16), files };
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`cas_core ${rulesVersion} (${manifest.digest}): ${files.length} files -> ${out}`);

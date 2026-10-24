/**
 * Emits generated artifacts consumed outside TypeScript:
 *   json/cas-fixtures.json  — CAS oracle payloads for pytest (packages/cas-core)
 *   json/schema/*.json      — JSON Schema for backend Pydantic codegen
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CAS_CASES, buildCasPayload, demoCases } from '../fixtures';
import * as api from '../src/api';
import * as schemas from '../src/schemas';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'json');
mkdirSync(join(root, 'schema'), { recursive: true });

const cases = [...CAS_CASES, ...demoCases()].map((c) => ({ id: c.id, note: c.note, expect: c.expect, payload: buildCasPayload(c) }));
writeFileSync(join(root, 'cas-fixtures.json'), `${JSON.stringify(cases, null, 2)}\n`);

const exported: Record<string, z.ZodType> = {
  Notebook: schemas.NotebookSchema,
  Line: schemas.LineSchema,
  Proof: schemas.ProofSchema,
  Meta: schemas.MetaSchema,
  RecognizeInput: api.RecognizeInputSchema,
  RecognizeResult: api.RecognizeResultSchema,
  SuggestInput: api.SuggestInputSchema,
  CandidateDraftResult: api.CandidateDraftResultSchema,
  OcrPageInput: api.OcrPageInputSchema,
  OcrPageResult: api.OcrPageResultSchema,
  Capabilities: api.CapabilitiesSchema,
  Health: api.HealthSchema,
};
for (const [name, schema] of Object.entries(exported)) {
  writeFileSync(join(root, 'schema', `${name}.json`), `${JSON.stringify(z.toJSONSchema(schema, { unrepresentable: 'any' }), null, 2)}\n`);
}
console.log(`wrote ${cases.length} CAS fixtures and ${Object.keys(exported).length} JSON schemas to ${root}`);

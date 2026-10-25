import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LineSchema, type Line, type Notebook } from '@mn/contracts';
import { contextLinesFor, hasMath, hasUnresolvedWrong, isMemo, newDraftLine } from '../../src/core/notebook/model';
import { exportSnapshot, serializeNotebook } from '../../src/core/export/document';
import { buildNotebook } from '../../src/core/presets';

describe('memo line feature', () => {
  it('validates LineSchema with is_memo', () => {
    const valid = LineSchema.parse({
      id: 'L1',
      version: 1,
      source: 'user',
      role: 'step',
      state: 'DRAFT',
      ink: [],
      segments: [],
      is_memo: true,
    });
    assert.equal(valid.is_memo, true);

    const validMath = LineSchema.parse({
      id: 'L2',
      version: 1,
      source: 'user',
      role: 'step',
      state: 'DRAFT',
      ink: [],
      segments: [],
      is_memo: false,
    });
    assert.equal(validMath.is_memo, false);
  });

  it('newDraftLine supports isMemo flag', () => {
    const normal = newDraftLine();
    assert.equal(normal.is_memo, false);
    assert.equal(isMemo(normal), false);

    const memo = newDraftLine(true);
    assert.equal(memo.is_memo, true);
    assert.equal(isMemo(memo), true);
  });

  it('hasMath is false for memo lines', () => {
    const memoWithMathSegments: Line = {
      id: 'L1',
      version: 1,
      source: 'user',
      role: 'step',
      state: 'SETTLED',
      ink: [],
      is_memo: true,
      segments: [{ type: 'math', expr: ['Add', 1, 2], notation: 'plain', latex: '1 + 2' }],
    };
    assert.equal(hasMath(memoWithMathSegments), false);

    const mathLine: Line = {
      ...memoWithMathSegments,
      is_memo: false,
    };
    assert.equal(hasMath(mathLine), true);
  });

  it('contextLinesFor excludes memo lines from mathematical derivation context', () => {
    const nb: Notebook = {
      ...buildNotebook('expansion', 'ja'),
      lines: [
        {
          id: 'L1',
          version: 1,
          source: 'user',
          role: 'step',
          state: 'SETTLED',
          ink: [],
          segments: [{ type: 'math', expr: ['Equal', 'x', 1], notation: 'plain', latex: 'x = 1' }],
        },
        {
          id: 'L2_memo',
          version: 1,
          source: 'user',
          role: 'step',
          state: 'SETTLED',
          ink: [],
          is_memo: true,
          segments: [],
        },
        {
          id: 'L3',
          version: 1,
          source: 'user',
          role: 'step',
          state: 'DRAFT',
          ink: [],
          segments: [],
        },
      ],
    };

    const ctx = contextLinesFor(nb, 'L3');
    assert.equal(ctx.length, 1);
    assert.equal(ctx[0]?.id, 'L1');
  });

  it('hasUnresolvedWrong ignores memo lines', () => {
    const nb: Notebook = {
      ...buildNotebook('expansion', 'ja'),
      recoveries: [],
      lines: [
        {
          id: 'L_memo',
          version: 1,
          source: 'user',
          role: 'step',
          state: 'SETTLED',
          ink: [],
          is_memo: true,
          segments: [],
          verified: {
            verification_id: 'V1',
            input_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
            proof: {
              status: 'wrong',
              conditions: [],
              evidence: [],
              hints: [],
              segment_results: [],
              depends_on: [],
              depends_on_unverified: false,
              unverified_ancestors: [],
              input_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
              mock: false,
              cas: { version: '2.0.0', rules_version: '2.0.0', elapsed_ms: 1, timed_out: false },
            },
          },
        },
      ],
    };

    assert.equal(hasUnresolvedWrong(nb), false);
  });

  it('exports memo lines cleanly to PDF without LaTeX conversion or verification error', () => {
    const nb: Notebook = {
      ...buildNotebook('expansion', 'ja'),
      lines: [
        {
          id: 'L1',
          version: 1,
          source: 'user',
          role: 'step',
          state: 'SETTLED',
          ink: [],
          is_memo: true,
          segments: [],
        },
      ],
    };

    const snapshot = exportSnapshot(nb);
    assert.equal(snapshot.lines[0]?.is_memo, true);

    const { document } = serializeNotebook(snapshot, 'ja');
    const docJson = JSON.stringify(document);
    assert.ok(docJson.includes('［手書きメモ］'));
    assert.ok(docJson.includes('メモ（検証対象外）'));
  });
});

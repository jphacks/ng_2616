import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NotebookSchema, declaredFunctions, theoremOf } from '@mn/contracts';
import { givenHash } from '../../src/core/lean/route';
import { withDeclarations } from '../../src/core/notebook/model';
import { PRESET_IDS, PRESET_THEOREMS, buildNotebook } from '../../src/core/presets';

const shown = (nb: ReturnType<typeof buildNotebook>) =>
  nb.lines.map((l) => [l.role, l.segments.map((s) => (s.type === 'math' ? s.latex : s.text)).join(' ')]);

describe('templates open with lines, not a problem card', () => {
  for (const id of PRESET_IDS) {
    it(`${id} is a valid notebook ending in an empty draft`, () => {
      const nb = buildNotebook(id, 'en');
      assert.deepEqual(NotebookSchema.parse(nb), nb);
      const last = nb.lines[nb.lines.length - 1]!;
      assert.equal(last.state, 'DRAFT');
      assert.ok(nb.lines.slice(0, -1).every((l) => l.state === 'SETTLED' && !l.verified));
      // the lines are already read with the functions they declare
      assert.equal(withDeclarations(nb.lines), nb.lines);
    });
  }

  it('blank has only the draft', () => {
    assert.equal(buildNotebook('blank', 'en').lines.length, 1);
  });

  it('Schrödinger: statement, TDSE, then the functions and the conditions on one line each, all given', () => {
    const nb = buildNotebook('schrodinger', 'en');
    const lines = shown(nb).slice(0, -1);
    assert.equal(lines.length, 4);
    assert.ok(lines.every(([role]) => role === 'premise'));
    assert.match(lines[0]![1]!, /^Starting from the time-dependent Schrödinger equation/);
    assert.deepEqual(lines.slice(2).map(([, text]) => text), [
      'Given \\Psi\\left(x, t\\right) \\psi\\left(x\\right) \\phi\\left(t\\right) V\\left(x\\right)',
      'where m > 0, L > 0, n \\in \\mathbb{Z}^{+}, \\psi\\left(x\\right) \\ne 0, \\phi\\left(t\\right) \\ne 0',
    ]);
    assert.deepEqual(shown(buildNotebook('schrodinger', 'ja')).slice(2, 4).map(([, text]) => text.split(' ')[0]), ['関数', 'ただし']);
    assert.deepEqual(declaredFunctions(nb.lines).map((f) => f.name), ['Psi', 'psi', 'phi', 'V']);
    // the TDSE line reads Ψ as Ψ(x,t) although the declaration comes after it
    const tdse = nb.lines[1]!.segments[0]!;
    assert.ok(tdse.type === 'math' && JSON.stringify(tdse.expr).includes('["PartialD",["Apply","Psi"],"t"]'));
  });

  it('integral: the definition stays a definition; the function and its condition share a given line', () => {
    const lines = shown(buildNotebook('integral', 'en')).slice(0, -1);
    assert.deepEqual(lines.map(([role]) => role), ['premise', 'definition', 'premise']);
    assert.equal(lines[2]![1], 'Given I\\left(a\\right) where a > 0');
  });

  it('proof templates carry their Lean theorem, tied to their given lines, and state the claim in prose', () => {
    for (const id of ['induction', 'epsilon_delta'] as const) {
      for (const lang of ['en', 'ja'] as const) {
        const nb = buildNotebook(id, lang);
        const theorem = theoremOf(nb);
        assert.equal(theorem?.statement, PRESET_THEOREMS[id]);
        assert.equal(theorem?.source, 'template');
        assert.equal(theorem?.given_hash, givenHash(nb.lines));
        // a formula on a given line is a fact the CAS may use: the claim to prove must not be one
        const given = nb.lines.filter((l) => l.role === 'premise');
        assert.equal(given.length, 1);
        assert.ok(given[0]!.segments.every((s) => s.type === 'text' || (typeof s.expr === 'string' && s.expr.length === 1)), `${id}/${lang}`);
      }
    }
    assert.equal(theoremOf(buildNotebook('integral', 'en')), undefined);
  });

  it('the title is the notebook title only', () => {
    const nb = buildNotebook('schrodinger', 'ja');
    assert.equal(nb.title, 'シュレディンガー方程式：TDSE → TISE');
    assert.ok(!('problem' in nb));
  });
});

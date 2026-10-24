import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Meta } from '@mn/contracts';
import { suggestBlockerOf, suggestModeOf, type BlockerInput } from '../../../src/core/candidates/blocker';
import { candidateHash, lineHash, mathKey } from '../../../src/core/candidates/hash';
import { rejectionKey, targetKindOf } from '../../../src/core/candidates/rejection';
import { matchesSlot, mismatchedFields, type SlotMeta } from '../../../src/core/candidates/slot';
import { line, notebook, segs, settled, stroke, ZERO } from './fixtures';

describe('core/candidates/hash', () => {
  it('mathKey keeps formulas in order with expr and notation only', () => {
    const k = mathKey(segs('so $x = 1$, $= 2$'));
    assert.equal(k.length, 2);
    assert.deepEqual(Object.keys(k[0]!).sort(), ['expr', 'notation']);
    assert.equal(k[1]!.notation, 'continuation');
  });

  it('lineHash ignores prose and the printed latex, but not order, notation or IR', () => {
    assert.equal(lineHash(segs('$x + 1$')), lineHash(segs('add: $x + 1$ done')));
    assert.notEqual(lineHash(segs('$x + 1$')), lineHash(segs('$1 + x$')));
    assert.notEqual(lineHash(segs('$x = 1$')), lineHash(segs('$= 1$')));
    assert.notEqual(lineHash(segs('$x = 1$, $y = 2$')), lineHash(segs('$y = 2$, $x = 1$')));
  });

  it('candidateHash depends on the mode and the lines, not on prose', () => {
    const a = segs('$x = 1$');
    assert.equal(candidateHash('NEXT_STEP', [a]), candidateHash('NEXT_STEP', [segs('so $x = 1$')]));
    assert.notEqual(candidateHash('NEXT_STEP', [a]), candidateHash('COMPLETE_RHS', [a]));
    assert.notEqual(candidateHash('NEXT_STEP', [a]), candidateHash('NEXT_STEP', [a, a]));
    assert.match(candidateHash('NEXT_STEP', [a]), /^sha256:[0-9a-f]{64}$/);
  });
});

describe('core/candidates/rejection', () => {
  it('keys the history by semantic hash, mode and target kind', () => {
    const k = rejectionKey(ZERO, 'NEXT_STEP', 'new');
    assert.equal(k, `${ZERO}:NEXT_STEP:new`);
    assert.notEqual(k, rejectionKey(ZERO, 'COMPLETE_RHS', 'existing'));
    assert.notEqual(k, rejectionKey(`sha256:${'1'.repeat(64)}`, 'NEXT_STEP', 'new'));
    assert.equal(rejectionKey(ZERO, 'COMPLETE_RHS'), rejectionKey(ZERO, 'COMPLETE_RHS', 'existing'));
    assert.equal(targetKindOf('NEXT_STEP'), 'new');
  });
});

describe('core/candidates/slot (R16)', () => {
  const slot: SlotMeta = {
    request_id: '00000000-0000-4000-8000-000000000001',
    notebook_id: '00000000-0000-4000-8000-000000000002',
    client_session_id: '00000000-0000-4000-8000-000000000003',
    client_epoch: 4,
    line_id: 'L3',
    line_version: 2,
    context_fingerprint: ZERO,
  };

  it('accepts a result whose seven fields all equal the slot', () => {
    assert.equal(matchesSlot(slot, { ...slot } satisfies Meta), true);
    assert.deepEqual(mismatchedFields(slot, slot), []);
  });

  for (const [field, other] of [
    ['request_id', '00000000-0000-4000-8000-0000000000ff'],
    ['notebook_id', '00000000-0000-4000-8000-0000000000ff'],
    ['client_session_id', '00000000-0000-4000-8000-0000000000ff'],
    ['client_epoch', 5],
    ['line_id', 'L4'],
    ['line_version', 3],
    ['context_fingerprint', `sha256:${'1'.repeat(64)}`],
  ] as const) {
    it(`discards a result whose ${field} differs`, () => {
      const r = { ...slot, [field]: other } as SlotMeta;
      assert.equal(matchesSlot(slot, r), false);
      assert.deepEqual(mismatchedFields(slot, r), [field]);
    });
  }

  it('a result without line_id/line_version does not match a slot that has them', () => {
    const { line_id: _l, line_version: _v, ...bare } = slot;
    assert.equal(matchesSlot(slot, bare), false);
    assert.equal(matchesSlot(bare, bare), true);
  });
});

describe('core/candidates/blocker (R4, R10)', () => {
  const ok = settled('L1', '$x = 1$', 'ok');
  const base = (over: Partial<BlockerInput> = {}): BlockerInput => ({ notebook: notebook([ok]), casReady: true, candidate: null, activeLine: undefined, ...over });

  it('D1 can start after an ok line', () => {
    assert.equal(suggestBlockerOf(base()), null);
  });

  it('D1 no notebook / CAS not ready / nothing written', () => {
    assert.equal(suggestBlockerOf(base({ notebook: null })), 'none');
    assert.equal(suggestBlockerOf(base({ casReady: false })), 'cas');
    assert.equal(suggestBlockerOf(base({ notebook: notebook([line('D', 'DRAFT')]) })), 'empty');
  });

  it('D1 a pending line blocks', () => {
    for (const state of ['RECOGNIZING', 'VERIFYING'] as const) {
      assert.equal(suggestBlockerOf(base({ notebook: notebook([ok, line('P', state)]) })), 'pending');
    }
  });

  it('D1 an unresolved wrong line, or an unresolved recovery, blocks before anything else about the line', () => {
    const wrong = settled('W', '$x = 2$', 'wrong');
    assert.equal(suggestBlockerOf(base({ notebook: notebook([ok, wrong]) })), 'wrong');
    const rec = [{ root_line_id: 'W', current_line_id: 'R', phase: 'UNRESOLVED' as const, opened_at: {} }];
    assert.equal(suggestBlockerOf(base({ notebook: notebook([ok], rec) })), 'wrong');
    // a wrong line that was superseded by a revision no longer blocks
    assert.equal(suggestBlockerOf(base({ notebook: notebook([ok, { ...wrong, state: 'SUPERSEDED' }]) })), null);
  });

  it('D1 only ok/none and the listed unknown reasons can continue', () => {
    const at = (status: 'ok' | 'none' | 'unknown', reason?: string) => suggestBlockerOf(base({ notebook: notebook([settled('L1', '$x = 1$', status, reason)]) }));
    assert.equal(at('none', 'DEFINITION'), null);
    for (const reason of ['TIMEOUT', 'NO_EVIDENCE', 'NUM_ONLY', 'UNSUPPORTED', 'SUBSET_OF_SOLUTIONS']) assert.equal(at('unknown', reason), null, reason);
    for (const reason of ['UNREADABLE', 'CAS_ERROR', 'AMBIGUOUS_UNKNOWNS']) assert.equal(at('unknown', reason), 'cannot-continue', reason);
  });

  it('D1 an incomplete "L =" line may start (it completes the right-hand side)', () => {
    const inc = settled('L1', '$A = $', 'unknown', 'INCOMPLETE');
    assert.equal(suggestBlockerOf(base({ notebook: notebook([inc]) })), null);
  });

  it('D1 one candidate at a time, and never while the student is writing', () => {
    for (const candidate of ['GENERATING', 'VERIFYING', 'READY', 'HELD'] as const) assert.equal(suggestBlockerOf(base({ candidate })), 'busy', candidate);
    for (const candidate of ['NONE', 'ADOPTED', 'REJECTED', 'STALE'] as const) assert.equal(suggestBlockerOf(base({ candidate })), null, candidate);
    const inking = line('D', 'DRAFT', { ink: [stroke] });
    assert.equal(suggestBlockerOf(base({ activeLine: inking })), 'writing');
    assert.equal(suggestBlockerOf(base({ activeLine: line('D', 'DRAFT') })), null, 'an empty draft is not writing');
  });

  it('D1 the order of reasons: wrong beats busy beats writing', () => {
    const wrong = settled('W', '$x = 2$', 'wrong');
    const inking = line('D', 'DRAFT', { ink: [stroke] });
    assert.equal(suggestBlockerOf(base({ notebook: notebook([wrong]), candidate: 'READY', activeLine: inking })), 'wrong');
    assert.equal(suggestBlockerOf(base({ candidate: 'READY', activeLine: inking })), 'busy');
  });

  it('D2 chooses COMPLETE_RHS only for an unfinished Equal line', () => {
    assert.equal(suggestModeOf(settled('L1', '$A = $', 'unknown', 'INCOMPLETE')), 'COMPLETE_RHS');
    assert.equal(suggestModeOf(settled('L1', '$x = 1$', 'ok')), 'NEXT_STEP');
    assert.equal(suggestModeOf(settled('L1', '$x < 1$', 'unknown', 'INCOMPLETE')), 'NEXT_STEP');
  });
});

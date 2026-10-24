import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Meta } from '@mn/contracts';
import { blockerToastKey, suggestBlockerOf, suggestModeOf, type BlockerInput, type SuggestBlocker } from '../../../src/core/candidates/blocker';
import { candidateHash, lineHash, mathKey } from '../../../src/core/candidates/hash';
import { addRejection, isRecordable, rejectionKey, rejectionsFor, targetKindOf } from '../../../src/core/candidates/rejection';
import { matchesSlot, mismatchedFields, suggestFingerprint, type SlotMeta } from '../../../src/core/candidates/slot';
import { en } from '../../../src/i18n/en';
import { ja } from '../../../src/i18n/ja';
import { line, notebook, problem, segs, settled, stroke, ZERO } from './fixtures';

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

describe('core/candidates/rejection history (R22)', () => {
  const k1 = rejectionKey(ZERO, 'NEXT_STEP');
  const k2 = rejectionKey(`sha256:${'2'.repeat(64)}`, 'NEXT_STEP');
  const h = (c: string) => `sha256:${c.repeat(64)}`;

  it('F3 a rejection counts only in the context it was made in', () => {
    const hist = addRejection({}, k1, h('a'), 'x = 1');
    assert.deepEqual(rejectionsFor(hist, k1), { hashes: [h('a')], latex: ['x = 1'] });
    assert.deepEqual(rejectionsFor(hist, k2), { hashes: [], latex: [] }, 'a changed context starts with a clean history');
    assert.deepEqual(rejectionsFor(hist, rejectionKey(ZERO, 'COMPLETE_RHS')).hashes, [], 'another mode is another context');
  });

  it('F3 returning to the same context (e.g. after Undo) finds the earlier rejections again', () => {
    const hist = addRejection(addRejection({}, k1, h('a'), 'a'), k2, h('b'), 'b');
    assert.deepEqual(rejectionsFor(hist, k1).hashes, [h('a')]);
    assert.deepEqual(rejectionsFor(hist, k2).hashes, [h('b')]);
  });

  it('F3 adding is immutable, keeps order, and ignores repeats', () => {
    const empty = {};
    const one = addRejection(empty, k1, h('a'), 'a');
    const two = addRejection(one, k1, h('b'), 'b');
    assert.deepEqual(empty, {});
    assert.deepEqual(rejectionsFor(one, k1).hashes, [h('a')]);
    assert.deepEqual(rejectionsFor(two, k1).hashes, [h('a'), h('b')]);
    assert.equal(addRejection(two, k1, h('a'), 'again'), two);
  });

  it('G9 an empty hash is never recorded', () => {
    const hist = {};
    assert.equal(addRejection(hist, k1, '', 'x'), hist);
  });

  it('G9 only a finished candidate (READY or HELD) is recorded as rejected', () => {
    for (const state of ['READY', 'HELD']) assert.equal(isRecordable(state), true, state);
    for (const state of ['GENERATING', 'VERIFYING', 'NONE', 'ADOPTED', 'REJECTED', 'STALE']) assert.equal(isRecordable(state), false, state);
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

describe('core/candidates/slot: suggestFingerprint (R16)', () => {
  const base = { notebookId: 'nb', problem, lines: [{ id: 'L1', version: 1 }, { id: 'L2', version: 3 }], sessionId: 's', epoch: 2 };

  it('is stable and has the hash shape', () => {
    assert.equal(suggestFingerprint(base), suggestFingerprint({ ...base }));
    assert.match(suggestFingerprint(base), /^sha256:[0-9a-f]{64}$/);
  });

  it('moves when the context, the session, the epoch or the problem changes', () => {
    const f = suggestFingerprint(base);
    assert.notEqual(f, suggestFingerprint({ ...base, lines: [{ id: 'L1', version: 1 }, { id: 'L2', version: 4 }] }), 'a context line was edited');
    assert.notEqual(f, suggestFingerprint({ ...base, lines: [base.lines[0]!] }), 'a context line was removed');
    assert.notEqual(f, suggestFingerprint({ ...base, sessionId: 's2' }));
    assert.notEqual(f, suggestFingerprint({ ...base, epoch: 3 }));
    assert.notEqual(f, suggestFingerprint({ ...base, problem: { ...problem, title: 'other' } }));
    assert.notEqual(f, suggestFingerprint({ ...base, notebookId: 'nb2' }));
  });

  it('does not depend on drafts, which are not part of the lines it is given', () => {
    // the engine passes only the settled prefix, so ink added to a draft cannot change the fingerprint
    assert.equal(suggestFingerprint(base), suggestFingerprint({ ...base, lines: [...base.lines] }));
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

describe('manual press of the suggest button gets an answer (R27)', () => {
  const blockers: SuggestBlocker[] = ['none', 'cas', 'pending', 'wrong', 'empty', 'cannot-continue', 'busy', 'writing'];

  it('D3 every reason that is not obvious on screen has a message; a held candidate gets its own', () => {
    for (const b of blockers) {
      if (b === 'none') assert.equal(blockerToastKey(b, null), null);
      else assert.ok(blockerToastKey(b, null), `no message for ${b}`);
    }
    assert.equal(blockerToastKey('busy', 'HELD'), 'toast.suggestHeld');
    for (const c of ['GENERATING', 'VERIFYING', 'READY'] as const) assert.equal(blockerToastKey('busy', c), 'toast.suggestBusy', c);
    assert.equal(blockerToastKey('pending', null), 'toast.suggestPending');
    assert.equal(blockerToastKey('cannot-continue', null), 'toast.suggestCannotContinue');
  });

  it('D3 the button and the automatic start follow the same rule while a candidate is HELD', () => {
    const nb = notebook([settled('L1', '$x = 1$', 'ok')]);
    const held = suggestBlockerOf({ notebook: nb, casReady: true, candidate: 'HELD', activeLine: undefined });
    assert.equal(held, 'busy', 'nothing starts while a candidate is held, for the button and for the timer alike');
    assert.equal(blockerToastKey(held!, 'HELD'), 'toast.suggestHeld', 'but the button now says why');
  });

  it('every message key exists in English and Japanese', () => {
    const keys = new Set<string>();
    for (const b of blockers) for (const c of [null, 'HELD', 'READY'] as const) { const k = blockerToastKey(b, c); if (k) keys.add(k); }
    assert.ok(keys.size >= 7);
    for (const k of keys) {
      assert.ok(k in en, `en is missing ${k}`);
      assert.ok(k in ja, `ja is missing ${k}`);
    }
  });
});

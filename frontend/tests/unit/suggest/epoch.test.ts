import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { abortOnEpochChange } from '../../../src/core/candidates/epoch';
import { useNotebook } from '../../../src/core/store/notebook-store';
import { line, notebook, settled } from './fixtures';

describe('abortOnEpochChange with the real notebook store (R17)', () => {
  beforeEach(() => {
    useNotebook.getState().load(notebook([settled('L1', '$x = 1$'), line('D', 'DRAFT')]), null);
  });

  it('G5 aborts the request when the epoch is bumped (confirm, revision start and problem edit all call bumpEpoch)', () => {
    const ctl = new AbortController();
    const stop = abortOnEpochChange(useNotebook, ctl);
    assert.equal(ctl.signal.aborted, false);
    useNotebook.getState().bumpEpoch();
    assert.equal(ctl.signal.aborted, true);
    stop();
  });

  it('G5 aborts on undo, redo and a notebook switch, which also move the epoch', () => {
    const st = useNotebook.getState();
    st.commit('ADD_DRAFT', (snap) => ({ ...snap, lines: [...snap.lines, line('E', 'DRAFT')] }));
    for (const act of [() => useNotebook.getState().undo(), () => useNotebook.getState().redo(), () => useNotebook.getState().load(notebook([]), null)]) {
      const ctl = new AbortController();
      const stop = abortOnEpochChange(useNotebook, ctl);
      act();
      assert.equal(ctl.signal.aborted, true);
      stop();
    }
  });

  it('G5 does not abort for changes that are not context changes (a stroke, a toast, the candidate itself)', () => {
    const ctl = new AbortController();
    const stop = abortOnEpochChange(useNotebook, ctl);
    useNotebook.getState().showToast('hello');
    useNotebook.getState().set('candidate', null);
    useNotebook.getState().set('suggesting', true);
    useNotebook.getState().commit('ADD_STROKE', (snap) => ({ ...snap, lines: snap.lines.map((l) => (l.id === 'D' ? { ...l, version: l.version + 1 } : l)) }), 'D');
    assert.equal(ctl.signal.aborted, false);
    stop();
  });

  it('G5 stops watching once the request has ended', () => {
    const ctl = new AbortController();
    const stop = abortOnEpochChange(useNotebook, ctl);
    stop();
    useNotebook.getState().bumpEpoch();
    assert.equal(ctl.signal.aborted, false);
  });

  it('is harmless when the request was already aborted', () => {
    const ctl = new AbortController();
    ctl.abort();
    const stop = abortOnEpochChange(useNotebook, ctl);
    assert.doesNotThrow(() => useNotebook.getState().bumpEpoch());
    stop();
  });
});

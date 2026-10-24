/** The part of the notebook store this module needs; the zustand store satisfies it as is. */
export interface EpochSource<S extends { epoch: number }> {
  getState(): S;
  subscribe(listener: (state: S, prev: S) => void): () => void;
}

/**
 * Aborts `ctl` as soon as the store's epoch differs from the one at subscription time (spec §7.3: confirmation,
 * Undo/Redo, revision start, problem change and notebook switch all bump the epoch and cancel related requests).
 * Returns the unsubscribe function; call it when the request ends.
 */
export function abortOnEpochChange<S extends { epoch: number }>(source: EpochSource<S>, ctl: AbortController): () => void {
  const epoch = source.getState().epoch;
  return source.subscribe((state) => {
    if (state.epoch !== epoch && !ctl.signal.aborted) ctl.abort();
  });
}

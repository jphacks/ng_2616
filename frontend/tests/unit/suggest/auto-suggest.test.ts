import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { candidateOf, rig, tick, until, type Rig } from './harness';

let r: Rig;
afterEach(() => {
  r?.store.setState({ autoSuggest: true });
  r?.dispose();
  mock.timers.reset();
});

describe('auto-complete switch (suggestions without pressing the button)', () => {
  it('H1 it is on by default: a suggestion starts by itself after the pause (R26)', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    r = rig();
    assert.equal(r.store.getState().autoSuggest, true);
    r.engine.scheduleSuggestion();
    mock.timers.tick(1200);
    await until(() => r.api.suggestCalls.length === 1, 'the automatic request');
  });

  it('H2 off: nothing starts by itself, the suggest button still works', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    r = rig();
    r.engine.setAutoSuggest(false);
    r.engine.scheduleSuggestion();
    mock.timers.tick(10_000);
    await tick();
    assert.equal(r.api.suggestCalls.length, 0);
    await r.engine.requestSuggestion(true);
    await until(() => candidateOf(r)?.state === 'READY', 'READY by the button');
    assert.equal(r.api.suggestCalls.length, 1);
  });

  it('H3 turning it off stops a wait that has started', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    r = rig();
    r.engine.scheduleSuggestion();
    mock.timers.tick(600);
    r.engine.setAutoSuggest(false);
    mock.timers.tick(10_000);
    await tick();
    assert.equal(r.api.suggestCalls.length, 0);
  });

  it('H4 turning it on starts the wait; a suggestion that is already shown stays when it is turned off', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    r = rig();
    r.engine.setAutoSuggest(false);
    r.engine.setAutoSuggest(true);
    mock.timers.tick(1200);
    await until(() => candidateOf(r)?.state === 'READY', 'READY');
    r.engine.setAutoSuggest(false);
    assert.equal(candidateOf(r)?.state, 'READY');
  });

  it('H5 the same value changes nothing', () => {
    r = rig();
    r.engine.setAutoSuggest(true);
    assert.equal(r.api.suggestCalls.length, 0);
    assert.equal(r.store.getState().autoSuggest, true);
  });
});

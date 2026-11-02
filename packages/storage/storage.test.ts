import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Storage } from './index.ts';
import type { CueSnapshot } from '../shared/index.ts';
const snapshot = (id: string): CueSnapshot => ({
  sessionId: id,
  status: 'draft',
  plan: null,
  settings: { demo: true, overlays: true, sceneSwitching: false, cooldownSec: 60, mode: 'chill' },
  twitch: { connected: false, displayName: '' },
  obs: { connected: false, streaming: false, scene: '', scenes: [] },
  overlay: { staged: false, text: '', url: 'http://127.0.0.1' },
  paused: false,
  events: [],
  actions: [],
  results: [],
  startedAt: null,
  error: null,
});
test('SQLite retains sessions independently and serializes defensive copies', (t) => {
  const store = new Storage(':memory:');
  t.after(() => store.close());
  assert.equal(store.latest(), null);
  assert.equal(store.get('missing'), null);
  const first = snapshot('first');
  store.save(first);
  first.status = 'ready';
  assert.equal(store.get('first')!.status, 'draft');
  const second = snapshot('second');
  store.save(second);
  assert.equal(store.latest()!.sessionId, 'second');
  first.status = 'ended';
  store.save(first);
  assert.equal(store.latest()!.sessionId, 'first');
  assert.equal(store.get('second')!.status, 'draft');
  const retrieved = store.get('first')!;
  retrieved.settings.overlays = false;
  assert.equal(store.get('first')!.settings.overlays, true);
  store.clear();
  assert.equal(store.latest(), null);
  assert.equal(store.get('first'), null);
  assert.equal(store.get('second'), null);
});
test('failed audit transaction rolls back the session snapshot', (t) => {
  const store = new Storage(':memory:');
  t.after(() => store.close());
  const state = snapshot('s');
  store.save(state);
  const bad = {
    ...state,
    status: 'ended' as const,
    events: [
      {
        id: undefined,
        sessionId: 's',
        ts: new Date().toISOString(),
        source: 'system' as const,
        kind: 'bad',
        payload: {},
      },
    ],
  } as unknown as CueSnapshot;
  assert.throws(() => store.save(bad));
  assert.equal(store.get('s')!.status, 'draft');
  state.status = 'ready';
  store.save(state);
  assert.equal(store.get('s')!.status, 'ready');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CueService } from './index.ts';
import { Storage } from '../storage/index.ts';
import { MockObsAdapter } from '../obs/index.ts';
import { MockTwitchAdapter } from '../twitch/index.ts';
import type { OverlayMessage } from '../shared/index.ts';

function setup() {
  const store = new Storage(':memory:');
  const obs = new MockObsAdapter();
  const twitch = new MockTwitchAdapter();
  const overlay = {
    url: 'http://127.0.0.1:4318/?token=test',
    state: null as OverlayMessage | null,
    verification: { revision: 0, acknowledgedRevision: 0, clients: 0 },
    fail: false,
    async publish(message: OverlayMessage) {
      if (this.fail) throw Error('Overlay unavailable');
      this.state = structuredClone(message);
      return { revision: ++this.verification.revision, clients: 0 };
    },
  };
  const service = new CueService({ store, obs, twitch, overlay });
  return { service, store, obs, twitch, overlay };
}
async function ready(s: CueService) {
  await s.createPlan('A city walk where chat picks the challenge', 'reality_tv');
  await s.connectTwitch();
  await s.connectObs();
  await s.stageOverlay();
  assert.equal((await s.checkReadiness()).ready, true);
}
async function live(s: CueService) {
  await ready(s);
  await s.startStream(s.requestConfirmation('start'));
}

test('complete mock journey produces verified autonomous overlay and persisted recap', async (t) => {
  const { service: s, store, obs, twitch, overlay } = setup();
  t.after(() => store.close());
  assert.equal((await s.checkReadiness()).ready, false);
  await assert.rejects(s.stageOverlay(), /Connect OBS/);
  await ready(s);
  const plan = s.snapshot().plan!;
  plan.title = 'Chat runs the city';
  plan.tags = ['Interactive'];
  await s.savePlan(plan);
  await s.applyMetadata(plan.id);
  assert.equal(twitch.metadata.title, 'Chat runs the city');
  assert.equal(obs.overlayUrl, overlay.url);
  await assert.rejects(s.startStream('invented-token'), /confirmation/);
  await s.startStream(s.requestConfirmation('start'));
  assert.equal(s.snapshot().status, 'live');
  await s.injectDemo();
  const state = s.snapshot();
  assert.equal(state.actions.length, 1);
  assert.equal(state.actions[0].status, 'succeeded');
  assert.equal(state.results[0].ok, true);
  assert.match(state.results[0].detail, /awaiting acknowledgement/);
  assert.match(overlay.state!.text!, /challenge/);
  assert.ok(
    state.actions[0].evidenceEventIds.every((id) =>
      state.events.some((e) => e.id === id && e.kind === 'chat.message'),
    ),
  );
  await assert.rejects(s.endStream('invented-token'), /confirmation/);
  assert.equal((await obs.getStreamStatus()).active, true);
  await s.endStream(s.requestConfirmation('stop'));
  assert.equal(s.snapshot().status, 'ended');
  assert.equal((await obs.getStreamStatus()).active, false);
  assert.equal(overlay.state!.type, 'HIDE_BANNER');
  const recap = await s.getRecap(state.sessionId);
  assert.equal(recap.interventions, 1);
  assert.equal(recap.failed, 0);
  assert.equal(recap.highlights.length, 1);
  assert.match(recap.summary, /4 chat messages/);
  assert.equal(store.get(state.sessionId)!.status, 'ended');
  const previousId = s.snapshot().sessionId;
  await s.createPlan('A calm follow-up stream', 'chill');
  assert.notEqual(s.snapshot().sessionId, previousId);
  assert.equal((await s.getRecap(previousId)).interventions, 1);
});

test('pause, cooldown, and dedup prevent extra automatic actions', async (t) => {
  const { service: s, store } = setup();
  t.after(() => store.close());
  await live(s);
  await s.pauseDirector(true);
  await s.injectDemo();
  assert.equal(s.snapshot().actions.length, 0);
  await s.pauseDirector(false);
  await s.ingestChat('one-new-message', 'viewer', 'challenge');
  assert.equal(s.snapshot().actions.length, 1);
  await s.ingestChat('one-new-message', 'viewer', 'challenge');
  assert.equal(s.snapshot().events.filter((e) => e.id === 'one-new-message').length, 1);
  await s.injectDemo();
  assert.equal(s.snapshot().actions.length, 1);
  await s.pauseDirector(true);
  await s.injectDemo();
  assert.equal(s.snapshot().actions.length, 1);
});

test('stream confirmations are one-use, operation-specific, and time-limited', async (t) => {
  const { service: s, store } = setup();
  t.after(() => store.close());
  await ready(s);
  const mismatched = s.requestConfirmation('start');
  await assert.rejects(s.endStream(mismatched), /confirmation/);
  await assert.rejects(s.startStream(mismatched), /confirmation/);
  const token = s.requestConfirmation('start');
  await s.startStream(token);
  await assert.rejects(s.startStream(token), /confirmation/);
  const stop = s.requestConfirmation('stop');
  const original = Date.now();
  const mocked = t.mock.method(Date, 'now', () => original + 31000);
  await assert.rejects(s.endStream(stop), /confirmation/);
  mocked.mock.restore();
  assert.equal(s.snapshot().status, 'live');
  await s.endStream(s.requestConfirmation('stop'));
  await assert.rejects(s.endStream(stop), /confirmation/);
});

test('illegal lifecycle operations and malformed plans are rejected without corrupting state', async (t) => {
  const { service: s, store } = setup();
  t.after(() => store.close());
  assert.throws(() => s.requestConfirmation('stop'), /No live/);
  await assert.rejects(s.createPlan('x', 'chill'));
  await ready(s);
  const plan = s.snapshot().plan!;
  await assert.rejects(s.savePlan({ ...plan, id: 'foreign-plan' }), /belong/);
  await assert.rejects(s.savePlan({ ...plan, title: '' }));
  await s.startStream(s.requestConfirmation('start'));
  await assert.rejects(s.createPlan('Another plan', 'chill'), /End the current/);
  await assert.rejects(s.replaceAdapters({ obs: new MockObsAdapter() }), /End the session/);
  await assert.rejects(s.disconnect('obs'), /End the stream/);
  await assert.rejects(s.deleteHistory(), /End the stream/);
  assert.throws(() => s.requestConfirmation('start'), /cannot be started/);
  assert.equal(s.snapshot().status, 'live');
});

test('overlay failure is logged and leaves a recoverable live session', async (t) => {
  const { service: s, store, overlay } = setup();
  t.after(() => store.close());
  await live(s);
  overlay.fail = true;
  await s.injectDemo();
  const state = s.snapshot();
  assert.equal(state.status, 'live');
  assert.equal(state.actions.length, 1);
  assert.equal(state.actions[0].status, 'failed');
  assert.equal(state.results[0].ok, false);
  assert.match(state.error!, /Overlay unavailable/);
  assert.ok(state.events.some((e) => e.kind === 'error'));
});

test('restoration retains audit history and requires reconnection before production', async (t) => {
  const { service: s, store, obs, twitch, overlay } = setup();
  t.after(() => store.close());
  await live(s);
  await s.injectDemo();
  const restored = new CueService({ store, obs, twitch, overlay });
  const state = restored.snapshot();
  assert.equal(state.status, 'live');
  assert.equal(state.paused, true);
  assert.equal(state.obs.connected, false);
  assert.equal(state.twitch.connected, false);
  assert.equal(state.overlay.staged, false);
  assert.equal(state.actions.length, 1);
  assert.match(state.error!, /interrupted/);
  const copy = restored.snapshot();
  copy.actions.length = 0;
  assert.equal(restored.snapshot().actions.length, 1);
});

test('editing or replacing the plan invalidates previously issued start confirmation', async (t) => {
  const { service: s, store } = setup();
  t.after(() => store.close());
  await ready(s);
  const beforeEdit = s.requestConfirmation('start');
  await s.savePlan({ ...s.snapshot().plan!, title: 'Updated title after confirmation' });
  await assert.rejects(s.startStream(beforeEdit), /confirmation/);
  assert.notEqual(s.snapshot().status, 'live');
  const beforeReplacement = s.requestConfirmation('start');
  await s.createPlan('A completely different stream', 'documentary');
  await assert.rejects(s.startStream(beforeReplacement), /confirmation/);
  assert.notEqual(s.snapshot().status, 'live');
});

test('start tolerates a delayed OBS output transition and keeps automation paused until active', async (t) => {
  const { service: s, store, obs } = setup();
  t.after(() => store.close());
  await ready(s);
  const originalStart = obs.startStream.bind(obs);
  const originalStatus = obs.getStreamStatus.bind(obs);
  let requested = false;
  let polls = 0;
  t.mock.method(obs, 'startStream', async () => {
    requested = true;
    await originalStart();
  });
  t.mock.method(obs, 'getStreamStatus', async () => {
    if (requested && ++polls === 1) {
      assert.equal(s.snapshot().paused, true);
      assert.equal(s.snapshot().status, 'live');
      return { active: false };
    }
    return originalStatus();
  });
  await s.startStream(s.requestConfirmation('start'));
  assert.ok(polls >= 2);
  assert.equal(s.snapshot().status, 'live');
  assert.equal(s.snapshot().obs.streaming, true);
  assert.equal(s.snapshot().paused, false);
  assert.ok(s.snapshot().events.some((e) => e.kind === 'stream.started'));
});

test('restored live production cannot resume before reconnection, staging, and active output', async (t) => {
  const { service: s, store, obs, twitch, overlay } = setup();
  t.after(() => store.close());
  await live(s);
  const restored = new CueService({ store, obs, twitch, overlay });
  await assert.rejects(restored.pauseDirector(false), /Reconnect OBS/);
  await restored.injectDemo();
  assert.equal(restored.snapshot().actions.length, 0);
  await restored.connectObs();
  await assert.rejects(restored.pauseDirector(false), /stage/);
  await restored.stageOverlay();
  await obs.stopStream();
  await restored.checkReadiness();
  await assert.rejects(restored.pauseDirector(false), /confirm streaming/);
  await restored.injectDemo();
  assert.equal(restored.snapshot().actions.length, 0);
  await obs.startStream();
  await restored.checkReadiness();
  await restored.pauseDirector(false);
  await restored.ingestChat('after-recovery', 'viewer', 'challenge please');
  assert.equal(restored.snapshot().paused, false);
  assert.equal(restored.snapshot().actions.length, 1);
  assert.equal(restored.snapshot().actions[0].status, 'succeeded');
});

test('restored disconnected live sessions can replace OBS for reconnect without allowing Twitch replacement', async (t) => {
  const { service: s, store, obs, twitch, overlay } = setup();
  t.after(() => store.close());
  await live(s);
  const restored = new CueService({ store, obs, twitch, overlay });
  const replacement = new MockObsAdapter();
  await restored.replaceAdapters({ obs: replacement });
  await restored.connectObs();
  assert.equal(restored.snapshot().obs.connected, true);
  assert.equal(restored.snapshot().obs.streaming, false);
  await assert.rejects(restored.replaceAdapters({ obs: new MockObsAdapter() }), /End the session/);
  await assert.rejects(
    restored.replaceAdapters({ twitch: new MockTwitchAdapter() }),
    /End the session/,
  );
  await restored.stageOverlay();
  assert.equal(replacement.overlayUrl, overlay.url);
  await replacement.startStream();
  await restored.checkReadiness();
  await restored.pauseDirector(false);
  assert.equal(restored.snapshot().paused, false);
});

test('an emergency pause during stream activation survives successful activation', async (t) => {
  const { service, store, obs } = setup();
  t.after(() => store.close());
  await ready(service);
  const originalStart = obs.startStream.bind(obs);
  obs.startStream = async () => {
    await service.pauseDirector(true);
    await originalStart();
  };
  await service.startStream(service.requestConfirmation('start'));
  assert.equal(service.snapshot().status, 'live');
  assert.equal(service.snapshot().paused, true);
  await service.injectDemo();
  assert.equal(service.snapshot().actions.length, 0);
});

test('OBS health refresh observes external stops and pauses automatic production', async (t) => {
  const { service, store, obs } = setup();
  t.after(() => store.close());
  await live(service);
  await obs.stopStream();
  await service.refreshProductionState();
  const snapshot = service.snapshot();
  assert.equal(snapshot.obs.streaming, false);
  assert.equal(snapshot.paused, true);
  assert.ok(snapshot.events.some((event) => event.kind === 'obs.status'));
  await service.injectDemo();
  assert.equal(service.snapshot().actions.length, 0);
});

test('successful connections clear their stale errors without hiding unrelated failures', async (t) => {
  const { service, store } = setup();
  t.after(() => store.close());
  service.reportError('OBS disconnected');
  await service.connectObs();
  assert.equal(service.snapshot().error, null);
  service.reportError('Twitch EventSub subscription failed');
  await service.connectTwitch();
  assert.equal(service.snapshot().error, null);
  service.reportError('Overlay state verification failed');
  await service.connectObs();
  assert.equal(service.snapshot().error, 'Overlay state verification failed');
});

test('Twitch is connected only after its chat subscription has succeeded', async (t) => {
  const { service, store, twitch } = setup();
  t.after(() => store.close());
  await service.connectTwitch();
  assert.equal(service.snapshot().twitch.connected, true);
  t.mock.method(twitch, 'subscribeChat', async () => { throw Error('EventSub subscription rejected'); });
  await assert.rejects(service.connectTwitch(), /subscription rejected/);
  assert.equal(service.snapshot().twitch.connected, false);
});

test('a failed Twitch reconnect clears the previous connected state', async (t) => {
  const { service, store, twitch } = setup();
  t.after(() => store.close());
  await service.connectTwitch();
  t.mock.method(twitch, 'connect', async () => { throw Error('Twitch temporarily unavailable'); });
  await assert.rejects(service.connectTwitch(), /temporarily unavailable/);
  assert.equal(service.snapshot().twitch.connected, false);
});

test('changing the OBS program scene pauses cues until the overlay is staged again', async (t) => {
  const { service, store, obs } = setup();
  t.after(() => store.close());
  await live(service);
  await obs.switchScene('Be right back');
  await service.refreshProductionState();
  assert.equal(service.snapshot().obs.scene, 'Be right back');
  assert.equal(service.snapshot().overlay.staged, false);
  assert.equal(service.snapshot().paused, true);
  await service.injectDemo();
  assert.equal(service.snapshot().actions.length, 0);
  await assert.rejects(service.pauseDirector(false), /stage the overlay/);
  await service.stageOverlay();
  await service.pauseDirector(false);
  await service.ingestChat('new-scene-message', 'viewer', 'challenge please');
  assert.equal(service.snapshot().actions.length, 1);
});

test('readiness checks the current OBS scene and drops a stale ready status', async (t) => {
  const { service, store, obs } = setup();
  t.after(() => store.close());
  await ready(service);
  assert.equal(service.snapshot().status, 'ready');
  await obs.switchScene('Just chatting');
  const readiness = await service.checkReadiness();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.checks.find(check => check.name === 'Overlay')!.ok, false);
  assert.equal(service.snapshot().status, 'draft');
  await service.stageOverlay();
  assert.equal((await service.checkReadiness()).ready, true);
});

test('OBS connection loss invalidates staging and reconnect requires a new staging pass', async (t) => {
  const { service, store, obs } = setup();
  t.after(() => store.close());
  await ready(service);
  const failure = t.mock.method(obs, 'getStreamStatus', async () => { throw Error('OBS disconnected'); });
  await service.refreshProductionState();
  assert.equal(service.snapshot().obs.connected, false);
  assert.equal(service.snapshot().overlay.staged, false);
  failure.mock.restore();
  await service.connectObs();
  assert.equal(service.snapshot().error, null);
  assert.equal((await service.checkReadiness()).ready, false);
  await service.stageOverlay();
  assert.equal((await service.checkReadiness()).ready, true);
});


test('staging immediately after a scene change keeps the new scene staged', async (t) => {
  const { service, store, obs } = setup();
  t.after(() => store.close());
  await ready(service);
  await obs.switchScene('Just chatting');
  await service.stageOverlay();
  assert.equal(service.snapshot().obs.scene, 'Just chatting');
  await service.refreshProductionState();
  assert.equal(service.snapshot().overlay.staged, true);
  assert.equal((await service.checkReadiness()).ready, true);
});


test('a failed restaging attempt cannot retain stale overlay readiness', async (t) => {
  const { service, store, obs } = setup();
  t.after(() => store.close());
  await ready(service);
  t.mock.method(obs, 'ensureOverlaySource', async () => { throw Error('OBS source unavailable'); });
  await assert.rejects(service.stageOverlay(), /source unavailable/);
  assert.equal(service.snapshot().overlay.staged, false);
  assert.equal((await service.checkReadiness()).ready, false);
});

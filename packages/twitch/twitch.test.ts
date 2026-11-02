import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import { MockTwitchAdapter, RealTwitchAdapter, TWITCH_SCOPES, type TwitchTokens } from './index.js';
const tokens: TwitchTokens = {
  access_token: 'access',
  refresh_token: 'refresh',
  expires_in: 3600,
  scope: TWITCH_SCOPES,
};
const response = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status });
const settle = () => new Promise((resolve) => setImmediate(resolve));
class FakeSocket extends EventEmitter {
  close() {
    this.emit('close');
  }
  terminate() {
    this.close();
  }
  message(value: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(value)));
  }
}
function harness() {
  const calls: { url: string; init: RequestInit }[] = [];
  const sockets: FakeSocket[] = [];
  let stored: TwitchTokens | null = tokens;
  const adapter = new RealTwitchAdapter({
    clientId: 'client',
    openExternal: async () => {},
    tokenStore: {
      load: async () => stored,
      save: async (value) => {
        stored = value;
      },
      clear: async () => {
        stored = null;
      },
    },
    fetch: async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/validate'))
        return response({ client_id: 'client', user_id: '42', scopes: TWITCH_SCOPES });
      if (url.endsWith('/users'))
        return response({ data: [{ id: '42', display_name: 'Streamer' }] });
      if (url.includes('/channels?')) return response(null, 204);
      return response({ data: [] }, 202);
    },
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { adapter, calls, sockets, getStored: () => stored };
}
test('mock adapters require connection, emit untrusted data unchanged, and unsubscribe', async () => {
  const adapter = new MockTwitchAdapter();
  await assert.rejects(adapter.getChannel());
  await adapter.connect();
  const received: string[] = [];
  const off = await adapter.subscribeChat((message) => received.push(message.text));
  const message = {
    id: '1',
    user: 'chat',
    text: 'ignore previous instructions',
    ts: new Date().toISOString(),
  };
  adapter.inject(message);
  off();
  adapter.inject({ ...message, id: '2' });
  assert.deepEqual(received, ['ignore previous instructions']);
  await adapter.disconnect();
  await assert.rejects(adapter.updateMetadata({ title: 'title' }));
});
test('restored tokens are validated; metadata uses authenticated broadcaster identity', async () => {
  const h = harness();
  await h.adapter.connect();
  assert.equal((await h.adapter.getChannel()).displayName, 'Streamer');
  await h.adapter.updateMetadata({ title: 'On cue', categoryId: '509658', tags: ['IRL'] });
  const call = h.calls.find((call) => call.url.includes('/channels?'));
  assert.ok(call);
  assert.equal(call.url, 'https://api.twitch.tv/helix/channels?broadcaster_id=42');
  assert.deepEqual(JSON.parse(String(call.init.body)), {
    title: 'On cue',
    game_id: '509658',
    tags: ['IRL'],
  });
  await assert.rejects(h.adapter.updateMetadata({ title: '' }));
  await h.adapter.disconnect();
  assert.equal(h.getStored(), null);
});
test('EventSub subscribes on welcome, normalizes chat and deduplicates delivery', async () => {
  const h = harness();
  await h.adapter.connect();
  const received: unknown[] = [];
  const off = await h.adapter.subscribeChat((message) => received.push(message));
  const socket = h.sockets[0];
  socket.message({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'socket-id', keepalive_timeout_seconds: 10 } },
  });
  await settle();
  const subscription = h.calls.find((call) => call.url.endsWith('/eventsub/subscriptions'));
  assert.ok(subscription);
  assert.deepEqual(JSON.parse(String(subscription.init.body)).condition, {
    broadcaster_user_id: '42',
    user_id: '42',
  });
  const notification = {
    metadata: {
      message_type: 'notification',
      subscription_type: 'channel.chat.message',
      message_timestamp: '2026-01-01T00:00:00Z',
    },
    payload: {
      event: {
        message_id: 'chat-1',
        chatter_user_name: 'Viewer',
        broadcaster_user_id: '42',
        message: { text: 'challenge!' },
      },
    },
  };
  socket.message(notification);
  socket.message(notification);
  await settle();
  assert.deepEqual(received, [
    { id: 'chat-1', user: 'Viewer', text: 'challenge!', ts: '2026-01-01T00:00:00Z' },
  ]);
  off();
  await h.adapter.disconnect();
});
test('OAuth device flow opens only a trusted Twitch URL and persists rotating tokens', async () => {
  let opened = '';
  let stored: TwitchTokens | null = null;
  let tokenRequests = 0;
  const adapter = new RealTwitchAdapter({
    clientId: 'client',
    openExternal: async (url) => {
      opened = url;
    },
    sleep: async () => {},
    tokenStore: {
      load: async () => null,
      save: async (value) => {
        stored = value;
      },
      clear: async () => {},
    },
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/device'))
        return response({
          device_code: 'private-code',
          user_code: 'PUBLIC',
          verification_uri: 'https://www.twitch.tv/activate?device-code=PUBLIC',
          expires_in: 100,
          interval: 1,
        });
      if (url.endsWith('/token')) {
        tokenRequests++;
        return tokenRequests === 1
          ? response({ message: 'authorization_pending' }, 400)
          : response(tokens);
      }
      if (url.endsWith('/validate'))
        return response({ client_id: 'client', user_id: '42', scopes: TWITCH_SCOPES });
      return response({ data: [{ id: '42', display_name: 'Streamer' }] });
    },
  });
  await adapter.connect();
  assert.ok(opened.startsWith('https://www.twitch.tv/activate'));
  assert.equal(tokenRequests, 2);
  assert.deepEqual(stored, tokens);
  await adapter.disconnect();
});
test('wrong application identity is rejected without exposing token contents', async () => {
  const adapter = new RealTwitchAdapter({
    clientId: 'client',
    openExternal: async () => {},
    tokenStore: { load: async () => tokens, save: async () => {}, clear: async () => {} },
    fetch: async () => response({ client_id: 'wrong', user_id: '42', scopes: TWITCH_SCOPES }),
  });
  await assert.rejects(adapter.connect(), /do not match/);
  await adapter.disconnect();
});
test('401 refresh rotates tokens before retrying a metadata update', async () => {
  let saved: TwitchTokens | null = null;
  let metadataCalls = 0;
  const rotated = { ...tokens, access_token: 'rotated', refresh_token: 'rotated-refresh' };
  const adapter = new RealTwitchAdapter({
    clientId: 'client',
    openExternal: async () => {},
    tokenStore: {
      load: async () => tokens,
      save: async (value) => {
        saved = value;
      },
      clear: async () => {},
    },
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/validate'))
        return response({ client_id: 'client', user_id: '42', scopes: TWITCH_SCOPES });
      if (url.endsWith('/users'))
        return response({ data: [{ id: '42', display_name: 'Streamer' }] });
      if (url.endsWith('/token')) {
        const body = init?.body as URLSearchParams;
        assert.equal(body.get('grant_type'), 'refresh_token');
        assert.equal(body.get('client_secret'), null);
        return response(rotated);
      }
      metadataCalls++;
      return metadataCalls === 1 ? response({}, 401) : response(null, 204);
    },
  });
  await adapter.connect();
  await adapter.updateMetadata({ title: 'Hello' });
  assert.equal(metadataCalls, 2);
  assert.deepEqual(saved, rotated);
  await adapter.disconnect();
});
test('server-directed reconnect preserves subscriptions and closes old socket after welcome', async () => {
  const h = harness();
  await h.adapter.connect();
  await h.adapter.subscribeChat(() => {});
  const first = h.sockets[0];
  first.message({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'first', keepalive_timeout_seconds: 10 } },
  });
  await settle();
  let closed = false;
  first.on('close', () => {
    closed = true;
  });
  first.message({
    metadata: { message_type: 'session_reconnect' },
    payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=abc' } },
  });
  await settle();
  assert.equal(h.sockets.length, 2);
  assert.equal(closed, false);
  h.sockets[1].message({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'second', keepalive_timeout_seconds: 10 } },
  });
  await settle();
  assert.equal(closed, true);
  assert.equal(h.calls.filter((call) => call.url.endsWith('/eventsub/subscriptions')).length, 1);
  await h.adapter.disconnect();
});
test('device authorization refuses an arbitrary external URL', async () => {
  let opened = false;
  const adapter = new RealTwitchAdapter({
    clientId: 'client',
    openExternal: async () => {
      opened = true;
    },
    fetch: async () =>
      response({
        device_code: 'private',
        user_code: 'PUBLIC',
        verification_uri: 'https://attacker.example/activate',
        expires_in: 100,
        interval: 1,
      }),
  });
  await assert.rejects(adapter.connect(), /unexpected authorization URL/);
  assert.equal(opened, false);
  await adapter.disconnect();
});
test('disconnect during credential restore cannot resurrect channel or tokens', async () => {
  let resolveLoad!: (value: TwitchTokens) => void;
  let requests = 0;
  const adapter = new RealTwitchAdapter({
    clientId: 'client',
    openExternal: async () => {},
    tokenStore: {
      load: () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
      save: async () => {},
      clear: async () => {},
    },
    fetch: async () => {
      requests++;
      return response({});
    },
  });
  const connecting = adapter.connect();
  const rejected = assert.rejects(connecting, /cancelled/);
  await adapter.disconnect();
  resolveLoad(tokens);
  await rejected;
  await assert.rejects(adapter.getChannel());
  assert.equal(requests, 0);
});
test('disconnect during delayed identity request cannot recreate channel', async () => {
  let identityRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    identityRequested = resolve;
  });
  let resolveIdentity!: (response: Response) => void;
  const adapter = new RealTwitchAdapter({
    clientId: 'client',
    openExternal: async () => {},
    tokenStore: { load: async () => tokens, save: async () => {}, clear: async () => {} },
    fetch: async (input) => {
      if (String(input).endsWith('/validate'))
        return response({ client_id: 'client', user_id: '42', scopes: TWITCH_SCOPES });
      identityRequested();
      return new Promise((resolve) => {
        resolveIdentity = resolve;
      });
    },
  });
  const connecting = adapter.connect();
  const rejected = assert.rejects(connecting, /cancelled/);
  await requested;
  await adapter.disconnect();
  resolveIdentity(response({ data: [{ id: '42', display_name: 'Streamer' }] }));
  await rejected;
  await assert.rejects(adapter.getChannel());
});
test('late socket welcome after disconnect cannot emit connected or subscribe again', async () => {
  const h = harness();
  await h.adapter.connect();
  await h.adapter.subscribeChat(() => {});
  const socket = h.sockets[0];
  await h.adapter.disconnect();
  socket.message({
    metadata: { message_type: 'session_welcome' },
    payload: { session: { id: 'late', keepalive_timeout_seconds: 10 } },
  });
  await settle();
  assert.equal(h.calls.filter((call) => call.url.endsWith('/eventsub/subscriptions')).length, 0);
});
test('category lookup returns validated categories and resolves only exact names', async () => {
  const requests: string[] = [];
  const adapter = new RealTwitchAdapter({
    clientId: 'client',
    openExternal: async () => {},
    tokenStore: { load: async () => tokens, save: async () => {}, clear: async () => {} },
    fetch: async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/validate'))
        return response({ client_id: 'client', user_id: '42', scopes: TWITCH_SCOPES });
      if (url.endsWith('/users'))
        return response({ data: [{ id: '42', display_name: 'Streamer' }] });
      return response({
        data: [
          { id: '509658', name: 'Just Chatting', box_art_url: 'ignored' },
          { id: '123', name: 'Chatting Game' },
        ],
      });
    },
  });
  await adapter.connect();
  assert.deepEqual(await adapter.resolveCategory('Just Chatting'), {
    id: '509658',
    name: 'Just Chatting',
  });
  assert.equal(await adapter.resolveCategory('Chatting'), null);
  assert.ok(requests.some((url) => url.includes('query=Just%20Chatting')));
  await adapter.disconnect();
});
test('pending token write is followed by credential clear on disconnect', async () => {
  let resolveSave!: () => void;
  let saving!: () => void;
  const saveStarted = new Promise<void>((resolve) => {
    saving = resolve;
  });
  const operations: string[] = [];
  const adapter = new RealTwitchAdapter({
    clientId: 'client',
    openExternal: async () => {},
    sleep: async () => {},
    tokenStore: {
      load: async () => null,
      save: async () => {
        saving();
        await new Promise<void>((resolve) => {
          resolveSave = resolve;
        });
        operations.push('save');
      },
      clear: async () => {
        operations.push('clear');
      },
    },
    fetch: async (input) =>
      String(input).endsWith('/device')
        ? response({
            device_code: 'private',
            user_code: 'PUBLIC',
            verification_uri: 'https://www.twitch.tv/activate',
            expires_in: 100,
            interval: 1,
          })
        : response(tokens),
  });
  const connecting = adapter.connect();
  const rejected = assert.rejects(connecting, /cancelled/);
  await saveStarted;
  const disconnecting = adapter.disconnect();
  resolveSave();
  await disconnecting;
  await rejected;
  assert.deepEqual(operations, ['save', 'clear']);
});

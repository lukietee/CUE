import WebSocket from 'ws';
import { z } from 'zod';
import type { ChatMessage, TwitchAdapter } from '../shared/index.js';

export const TWITCH_SCOPES = ['user:read:chat', 'channel:manage:broadcast'];
const TokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.array(z.string()).default([]),
});
export type TwitchCategory = { id: string; name: string };
export type TwitchTokens = z.infer<typeof TokenSchema>;
export interface TokenStore {
  load(): Promise<TwitchTokens | null>;
  save(tokens: TwitchTokens): Promise<void>;
  clear(): Promise<void>;
}
export interface TwitchOptions {
  clientId: string;
  openExternal: (url: string) => Promise<void>;
  tokenStore?: TokenStore;
  onAuthorization?: (info: { userCode: string; verificationUri: string }) => void;
  onStatus?: (message: string) => void;
  onError?: (error: Error) => void;
  fetch?: typeof fetch;
  socketFactory?: (url: string) => WebSocket;
  sleep?: (ms: number) => Promise<void>;
}
const ORIGIN = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';
const EVENTSUB = 'wss://eventsub.wss.twitch.tv/ws';
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Privileged-process only. Chat is untrusted data; this adapter never executes it. */
export class RealTwitchAdapter implements TwitchAdapter {
  private tokens: TwitchTokens | null = null;
  private channel: { broadcasterId: string; displayName: string } | null = null;
  private listeners = new Set<(message: ChatMessage) => void>();
  private sockets = new Set<WebSocket>();
  private current: WebSocket | null = null;
  private keepalive: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private validationTimer: ReturnType<typeof setInterval> | null = null;
  private seen = new Set<string>();
  private stopped = true;
  private generation = 0;
  private retries = 0;
  private refreshing: Promise<void> | null = null;
  private connecting: Promise<void> | null = null;
  private abortController = new AbortController();
  private storageQueue: Promise<void> = Promise.resolve();
  constructor(private options: TwitchOptions) {}
  private get fetcher() {
    return this.options.fetch ?? fetch;
  }
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    if (this.stopped) throw new Error('Twitch is disconnected.');
    const generation = this.generation;
    const response = await this.fetcher(url, {
      ...init,
      signal: AbortSignal.any([
        this.abortController.signal,
        init.signal ?? AbortSignal.timeout(15_000),
      ]),
    });
    this.assertGeneration(generation);
    return response;
  }
  private report(error: unknown) {
    this.options.onError?.(error instanceof Error ? error : new Error('Twitch connection failed'));
  }
  private async form(path: string, body: Record<string, string>) {
    return this.request(`${ORIGIN}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  }
  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.channel && !this.stopped) return;
    this.connecting = this.connectInternal().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
  private async connectInternal() {
    if (!this.options.clientId.trim())
      throw new Error('Set TWITCH_CLIENT_ID to a registered public Twitch application client ID.');
    this.stopped = false;
    this.abortController = new AbortController();
    const generation = ++this.generation;
    const restored = await this.options.tokenStore?.load();
    this.assertGeneration(generation);
    this.tokens = restored ? TokenSchema.parse(restored) : this.tokens;
    if (!this.tokens) await this.authorize(generation);
    this.assertGeneration(generation);
    try {
      await this.validate();
    } catch (error) {
      this.tokens = null;
      await this.clearTokens();
      throw error;
    }
    const response = await this.api('/users');
    const body = z
      .object({
        data: z.array(z.object({ id: z.string().regex(/^\d+$/), display_name: z.string().min(1) })),
      })
      .parse(await response.json());
    const user = body.data?.[0];
    if (!user) throw new Error('Twitch returned no channel identity. Reconnect Twitch.');
    this.assertGeneration(generation);
    this.channel = { broadcasterId: user.id, displayName: user.display_name };
    if (this.validationTimer) clearInterval(this.validationTimer);
    this.validationTimer = setInterval(
      () => {
        void this.validate().catch((error) => {
          this.report(error);
          void this.disconnect();
        });
      },
      60 * 60 * 1000,
    );
    this.validationTimer.unref?.();
    this.options.onStatus?.(`Connected as ${user.display_name}`);
  }
  private assertGeneration(generation: number) {
    if (this.stopped || generation !== this.generation)
      throw new Error('Twitch connection cancelled.');
  }
  private async authorize(generation: number) {
    this.options.onStatus?.('Waiting for Twitch authorization in your browser…');
    const response = await this.form('device', {
      client_id: this.options.clientId,
      scopes: TWITCH_SCOPES.join(' '),
    });
    if (!response.ok)
      throw new Error(
        `Twitch device authorization failed (${response.status}). Check the app is a public client.`,
      );
    const device = z
      .object({
        device_code: z.string(),
        user_code: z.string(),
        verification_uri: z.url(),
        expires_in: z.number().positive(),
        interval: z.number().positive(),
      })
      .parse(await response.json());
    this.assertGeneration(generation);
    const uri = new URL(device.verification_uri);
    if (
      uri.username ||
      uri.password ||
      uri.port ||
      uri.protocol !== 'https:' ||
      !['www.twitch.tv', 'twitch.tv', 'id.twitch.tv'].includes(uri.hostname)
    )
      throw new Error('Twitch returned an unexpected authorization URL.');
    this.options.onAuthorization?.({
      userCode: device.user_code,
      verificationUri: device.verification_uri,
    });
    await this.options.openExternal(device.verification_uri);
    const deadline = Date.now() + Math.min(device.expires_in, 1800) * 1000;
    let interval = Math.max(1, device.interval) * 1000;
    while (Date.now() < deadline) {
      await (this.options.sleep ?? wait)(interval);
      this.assertGeneration(generation);
      const tokenResponse = await this.form('token', {
        client_id: this.options.clientId,
        scopes: TWITCH_SCOPES.join(' '),
        device_code: device.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
      const body = (await tokenResponse.json()) as Record<string, unknown>;
      if (tokenResponse.ok) {
        this.assertGeneration(generation);
        await this.setTokens(TokenSchema.parse(body));
        return;
      }
      const code = String(body.message ?? body.error ?? '');
      if (code === 'authorization_pending') continue;
      if (code === 'slow_down') {
        interval += 5000;
        continue;
      }
      throw new Error('Twitch authorization was denied or expired. Connect again to retry.');
    }
    throw new Error('Twitch authorization expired. Connect again to retry.');
  }
  private enqueueStorage(operation: () => Promise<void>) {
    const pending = this.storageQueue.then(operation);
    this.storageQueue = pending.catch(() => {});
    return pending;
  }
  private clearTokens() {
    return this.enqueueStorage(async () => {
      await this.options.tokenStore?.clear();
    });
  }
  private async setTokens(tokens: TwitchTokens) {
    this.tokens = tokens;
    await this.enqueueStorage(async () => {
      await this.options.tokenStore?.save(tokens);
    });
  }
  private async refresh() {
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    this.refreshing = (async () => {
      if (!this.tokens) throw new Error('Twitch is disconnected.');
      const response = await this.form('token', {
        client_id: this.options.clientId,
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refresh_token,
      });
      if (!response.ok) {
        this.tokens = null;
        await this.clearTokens();
        throw new Error('Twitch authorization expired. Reconnect Twitch.');
      }
      const tokens = TokenSchema.parse(await response.json());
      this.assertGeneration(generation);
      await this.setTokens(tokens);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
  private async validate() {
    if (!this.tokens) throw new Error('Twitch is disconnected.');
    let response = await this.request(`${ORIGIN}/validate`, {
      headers: { Authorization: `OAuth ${this.tokens.access_token}` },
    });
    if (response.status === 401) {
      await this.refresh();
      response = await this.request(`${ORIGIN}/validate`, {
        headers: { Authorization: `OAuth ${this.tokens!.access_token}` },
      });
    }
    if (!response.ok)
      throw new Error(`Twitch token validation failed (${response.status}). Reconnect Twitch.`);
    const data = z
      .object({ client_id: z.string(), user_id: z.string().min(1), scopes: z.array(z.string()) })
      .parse(await response.json());
    if (
      data.client_id !== this.options.clientId ||
      TWITCH_SCOPES.some((scope) => !data.scopes.includes(scope))
    )
      throw new Error(
        'Twitch credentials do not match this app or required scopes. Reconnect Twitch.',
      );
  }
  private async api(path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
    if (!this.tokens) throw new Error('Connect Twitch first.');
    const response = await this.request(`${HELIX}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${this.tokens.access_token}`,
        'Client-Id': this.options.clientId,
        'Content-Type': 'application/json',
      },
    });
    if (response.status === 401 && attempt === 0) {
      await this.refresh();
      return this.api(path, init, attempt + 1);
    }
    if (response.status === 429 && attempt < 2) {
      const reset = Number(response.headers.get('Ratelimit-Reset'));
      const delay = Number.isFinite(reset)
        ? Math.min(30_000, Math.max(1000, reset * 1000 - Date.now()))
        : 1000;
      await (this.options.sleep ?? wait)(delay);
      return this.api(path, init, attempt + 1);
    }
    if (!response.ok)
      throw new Error(
        `Twitch request failed (${response.status}). ${response.status === 403 ? 'Check channel permissions.' : response.status === 429 ? 'Rate limited; retry shortly.' : 'Reconnect and try again.'}`,
      );
    return response;
  }
  async getChannel() {
    if (this.stopped || !this.channel) throw new Error('Connect Twitch first.');
    return { ...this.channel };
  }
  async searchCategories(query: string): Promise<TwitchCategory[]> {
    await this.getChannel();
    const term = z.string().trim().min(1).max(100).parse(query);
    const response = await this.api(
      `/search/categories?query=${encodeURIComponent(term)}&first=20`,
    );
    return z
      .object({
        data: z.array(z.object({ id: z.string().regex(/^\d+$/), name: z.string().min(1) })),
      })
      .parse(await response.json()).data;
  }
  async resolveCategory(name: string): Promise<TwitchCategory | null> {
    const matches = await this.searchCategories(name);
    return (
      matches.find((category) => category.name.toLowerCase() === name.trim().toLowerCase()) ?? null
    );
  }
  async updateMetadata(input: { title?: string; categoryId?: string; tags?: string[] }) {
    const value = z
      .object({
        title: z.string().min(1).max(140).optional(),
        categoryId: z.string().regex(/^\d+$/).optional(),
        tags: z.array(z.string().min(1).max(25)).max(10).optional(),
      })
      .strict()
      .parse(input);
    const channel = await this.getChannel();
    await this.api(`/channels?broadcaster_id=${encodeURIComponent(channel.broadcasterId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: value.title, game_id: value.categoryId, tags: value.tags }),
    });
  }
  async subscribeChat(listener: (message: ChatMessage) => void) {
    const generation = this.generation;
    await this.getChannel();
    this.assertGeneration(generation);
    this.listeners.add(listener);
    if (!this.current && !this.reconnectTimer) this.openSocket(EVENTSUB, false);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.closeSockets();
    };
  }
  private openSocket(url: string, migrating: boolean) {
    if (this.stopped || !this.listeners.size) return;
    const socket = (this.options.socketFactory ?? ((address) => new WebSocket(address)))(url);
    this.sockets.add(socket);
    const previous = this.current;
    if (!migrating) this.current = socket;
    let welcomed = false;
    const handshake = setTimeout(() => {
      if (!welcomed) socket.terminate();
    }, 15_000);
    handshake.unref?.();
    socket.on('message', (raw: { toString(): string }) => {
      void (async () => {
        if (this.stopped || !this.sockets.has(socket) || !this.listeners.size) return;
        let message: any;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const type = message.metadata?.message_type;
        if (type === 'session_welcome') {
          welcomed = true;
          clearTimeout(handshake);
          this.retries = 0;
          this.current = socket;
          if (migrating && previous && previous !== socket) {
            this.sockets.delete(previous);
            previous.close();
          }
          const session = message.payload?.session;
          if (!session?.id) throw new Error('Twitch EventSub welcome is malformed.');
          const timeout = Math.max(
            10,
            Math.min(600, Number(session.keepalive_timeout_seconds) || 10),
          );
          (socket as WebSocket & { cueTimeout?: number }).cueTimeout = timeout;
          this.armKeepalive(socket, timeout);
          if (!migrating) {
            const channel = await this.getChannel();
            await this.api('/eventsub/subscriptions', {
              method: 'POST',
              body: JSON.stringify({
                type: 'channel.chat.message',
                version: '1',
                condition: {
                  broadcaster_user_id: channel.broadcasterId,
                  user_id: channel.broadcasterId,
                },
                transport: { method: 'websocket', session_id: session.id },
              }),
            });
          }
          if (!this.stopped && this.sockets.has(socket))
            this.options.onStatus?.('Twitch chat is connected.');
          return;
        }
        if (type === 'session_reconnect') {
          const target = new URL(String(message.payload?.session?.reconnect_url));
          if (
            target.username ||
            target.password ||
            target.port ||
            target.protocol !== 'wss:' ||
            target.hostname !== 'eventsub.wss.twitch.tv'
          )
            throw new Error('Unexpected Twitch reconnect address.');
          this.openSocket(target.toString(), true);
          return;
        }
        if (socket === this.current)
          this.armKeepalive(
            socket,
            (socket as WebSocket & { cueTimeout?: number }).cueTimeout ?? 10,
          );
        if (type === 'revocation') {
          this.report(new Error('Twitch chat permission was revoked. Reconnect Twitch.'));
          await this.disconnect();
          return;
        }
        if (
          type !== 'notification' ||
          message.metadata?.subscription_type !== 'channel.chat.message'
        )
          return;
        const event = message.payload?.event;
        const parsed = z
          .object({
            message_id: z.string(),
            chatter_user_name: z.string(),
            message: z.object({ text: z.string() }),
            broadcaster_user_id: z.string(),
          })
          .safeParse(event);
        if (
          !parsed.success ||
          parsed.data.broadcaster_user_id !== this.channel?.broadcasterId ||
          this.seen.has(parsed.data.message_id)
        )
          return;
        this.seen.add(parsed.data.message_id);
        if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
        const normalized: ChatMessage = {
          id: parsed.data.message_id,
          user: parsed.data.chatter_user_name,
          text: parsed.data.message.text.slice(0, 4000),
          ts: String(message.metadata.message_timestamp ?? new Date().toISOString()),
        };
        for (const fn of this.listeners) fn(normalized);
      })().catch((error) => {
        this.report(error);
        socket.close();
      });
    });
    socket.on('error', (error: Error) =>
      this.report(new Error(`Twitch chat connection error: ${error.message}`)),
    );
    socket.on('close', () => {
      clearTimeout(handshake);
      this.sockets.delete(socket);
      if (socket === this.current) {
        this.current = null;
        if (this.keepalive) clearTimeout(this.keepalive);
        this.scheduleReconnect();
      } else if (migrating && !welcomed) {
        this.report(new Error('Twitch chat migration failed; retrying the connection.'));
        if (previous === this.current) previous?.close();
      }
    });
  }
  private armKeepalive(socket: WebSocket, seconds: number) {
    if (this.keepalive) clearTimeout(this.keepalive);
    this.keepalive = setTimeout(
      () => {
        if (socket === this.current) socket.terminate();
      },
      (seconds + 2) * 1000,
    );
    this.keepalive.unref?.();
  }
  private scheduleReconnect() {
    if (this.stopped || !this.listeners.size || this.reconnectTimer) return;
    this.options.onStatus?.('Twitch chat disconnected; reconnecting…');
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        this.openSocket(EVENTSUB, false);
      },
      Math.min(30_000, 1000 * 2 ** Math.min(this.retries++, 5)),
    );
    this.reconnectTimer.unref?.();
  }
  private closeSockets() {
    if (this.keepalive) clearTimeout(this.keepalive);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.keepalive = null;
    this.reconnectTimer = null;
    this.current = null;
    for (const socket of this.sockets) socket.close();
    this.sockets.clear();
  }
  async disconnect() {
    this.stopped = true;
    this.generation++;
    this.abortController.abort();
    if (this.validationTimer) clearInterval(this.validationTimer);
    this.validationTimer = null;
    this.listeners.clear();
    this.closeSockets();
    this.channel = null;
    this.tokens = null;
    await this.clearTokens();
    this.options.onStatus?.('Twitch disconnected.');
  }
}
export { RealTwitchAdapter as TwitchClient };

export class MockTwitchAdapter implements TwitchAdapter {
  private connected = false;
  private listeners = new Set<(message: ChatMessage) => void>();
  metadata: { title?: string; categoryId?: string; tags?: string[] } = {};
  async connect() {
    this.connected = true;
  }
  async getChannel() {
    if (!this.connected) throw new Error('Connect demo Twitch first.');
    return { broadcasterId: 'demo-channel', displayName: 'lukietee · Demo' };
  }
  async searchCategories(query: string): Promise<TwitchCategory[]> {
    await this.getChannel();
    const categories = [{ id: '509658', name: 'Just Chatting' }];
    return categories.filter((category) =>
      category.name.toLowerCase().includes(query.trim().toLowerCase()),
    );
  }
  async resolveCategory(name: string): Promise<TwitchCategory | null> {
    return (
      (await this.searchCategories(name)).find(
        (category) => category.name.toLowerCase() === name.trim().toLowerCase(),
      ) ?? null
    );
  }
  async updateMetadata(input: { title?: string; categoryId?: string; tags?: string[] }) {
    await this.getChannel();
    this.metadata = { ...input };
  }
  async subscribeChat(listener: (message: ChatMessage) => void) {
    await this.getChannel();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  inject(message: ChatMessage) {
    if (!this.connected) throw new Error('Connect demo Twitch first.');
    for (const listener of this.listeners) listener({ ...message });
  }
  async disconnect() {
    this.connected = false;
    this.listeners.clear();
  }
}

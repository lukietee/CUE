import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

type Responses = {
  GetSceneList: { scenes: { sceneName: string }[] };
  GetCurrentProgramScene: { currentProgramSceneName: string };
  GetStreamStatus: { outputActive: boolean };
  GetInputList: {
    inputs: { inputName: string; inputKind: string; unversionedInputKind?: string }[];
  };
  GetSceneItemList: { sceneItems: { sourceName: string; sceneItemId: number }[] };
  CreateInput: { sceneItemId: number };
  CreateSceneItem: { sceneItemId: number };
  GetInputSettings: { inputSettings: Record<string, unknown> };
  SetInputSettings: Record<string, never>;
  SetSceneItemEnabled: Record<string, never>;
  SetSceneItemIndex: Record<string, never>;
  SetCurrentProgramScene: Record<string, never>;
  StartStream: Record<string, never>;
  StopStream: Record<string, never>;
};
export interface ObsClient {
  on(event: 'ConnectionClosed' | 'ConnectionError', listener: () => void): unknown;
  connect(url: string, password?: string, options?: { rpcVersion: number }): Promise<void>;
  disconnect(): Promise<void>;
  call<K extends keyof Responses>(name: K, args?: Record<string, unknown>): Promise<Responses[K]>;
}
const digest = (value: string) => createHash('sha256').update(value).digest('base64');
export const authenticationResponse = (password: string, salt: string, challenge: string) =>
  digest(digest(password + salt) + challenge);

/** Minimal OBS WebSocket 5.x JSON transport; no generated or arbitrary requests. */
export class NativeObsClient extends EventEmitter implements ObsClient {
  private socket: WebSocket | null = null;
  private identified = false;
  private connecting: Promise<void> | null = null;
  private pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private timeoutMs = 10_000,
    private createSocket: (url: string) => WebSocket = (url) =>
      new WebSocket(url, { maxPayload: 4 * 1024 * 1024 }),
  ) {
    super();
  }
  async connect(url: string, password = '', options = { rpcVersion: 1 }): Promise<void> {
    if (this.identified) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = this.createSocket(url);
      this.socket = socket;
      let settled = false;
      const timeout = setTimeout(() => fail(new Error('OBS handshake timed out.')), this.timeoutMs);
      const fail = (error: Error) => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          reject(error);
        }
        socket.close();
      };
      socket.on('error', () => {
        this.emit('ConnectionError');
        fail(new Error('OBS WebSocket connection failed.'));
      });
      socket.on('close', () => {
        if (this.socket === socket) {
          this.identified = false;
          this.socket = null;
        }
        clearTimeout(timeout);
        for (const request of this.pending.values()) {
          clearTimeout(request.timeout);
          request.reject(new Error('OBS disconnected before responding.'));
        }
        this.pending.clear();
        if (!settled) {
          settled = true;
          reject(new Error('OBS closed during authentication. Check the password.'));
        }
        this.emit('ConnectionClosed');
      });
      socket.on('message', (raw: Buffer) => {
        try {
          const packet = JSON.parse(raw.toString());
          if (packet.op === 0) {
            const auth = packet.d?.authentication;
            const identify: Record<string, unknown> = {
              rpcVersion: options.rpcVersion,
              eventSubscriptions: 0,
            };
            if (auth) {
              if (typeof auth.salt !== 'string' || typeof auth.challenge !== 'string')
                throw new Error('Invalid OBS authentication challenge.');
              identify.authentication = authenticationResponse(password, auth.salt, auth.challenge);
            }
            socket.send(JSON.stringify({ op: 1, d: identify }));
          } else if (packet.op === 2) {
            this.identified = true;
            clearTimeout(timeout);
            if (!settled) {
              settled = true;
              resolve();
            }
          } else if (packet.op === 7) {
            const request = this.pending.get(packet.d?.requestId);
            if (!request) return;
            this.pending.delete(packet.d.requestId);
            clearTimeout(request.timeout);
            if (packet.d.requestStatus?.result === true)
              request.resolve(packet.d.responseData ?? {});
            else
              request.reject(
                new Error(
                  `OBS ${String(packet.d.requestType)} failed (${String(packet.d.requestStatus?.code)}): ${String(packet.d.requestStatus?.comment ?? 'request rejected')}`,
                ),
              );
          }
        } catch {
          fail(new Error('OBS sent an invalid protocol message.'));
        }
      });
    });
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }
  async call<K extends keyof Responses>(
    requestType: K,
    requestData?: Record<string, unknown>,
  ): Promise<Responses[K]> {
    const socket = this.socket;
    if (!socket || !this.identified || socket.readyState !== WebSocket.OPEN)
      throw new Error('OBS is disconnected.');
    const requestId = randomUUID();
    return new Promise<Responses[K]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`OBS ${requestType} timed out.`));
      }, this.timeoutMs);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as Responses[K]),
        reject,
        timeout,
      });
      socket.send(
        JSON.stringify({ op: 6, d: { requestType, requestId, requestData: requestData ?? {} } }),
        (error?: Error) => {
          if (error) {
            clearTimeout(timeout);
            this.pending.delete(requestId);
            reject(new Error('Could not send OBS request.'));
          }
        },
      );
    });
  }
  async disconnect() {
    this.identified = false;
    const socket = this.socket;
    if (!socket) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        socket.terminate();
        resolve();
      }, 1000);
      socket.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.close();
    });
  }
}

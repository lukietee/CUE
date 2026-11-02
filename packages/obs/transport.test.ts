import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { NativeObsClient, authenticationResponse } from './transport.ts';
class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: any[] = [];
  respond = true;
  constructor() {
    super();
    queueMicrotask(() =>
      this.emit(
        'message',
        JSON.stringify({
          op: 0,
          d: { rpcVersion: 1, authentication: { salt: 'salt', challenge: 'challenge' } },
        }),
      ),
    );
  }
  send(raw: string, callback?: (error?: Error) => void) {
    const packet = JSON.parse(raw);
    this.sent.push(packet);
    if (packet.op === 1)
      queueMicrotask(() =>
        this.emit('message', JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } })),
      );
    if (packet.op === 6 && this.respond)
      queueMicrotask(() =>
        this.emit(
          'message',
          JSON.stringify({
            op: 7,
            d: {
              requestId: packet.d.requestId,
              requestType: packet.d.requestType,
              requestStatus: {
                result: packet.d.requestType !== 'StartStream',
                code: packet.d.requestType === 'StartStream' ? 500 : 100,
              },
              responseData: { outputActive: false },
            },
          }),
        ),
      );
    callback?.();
  }
  close() {
    this.readyState = 3;
    queueMicrotask(() => this.emit('close'));
  }
  terminate() {
    this.close();
  }
}
test('native OBS authenticates, correlates replies, propagates rejected requests and disconnects', async () => {
  const socket = new FakeSocket();
  const client = new NativeObsClient(100, () => socket as unknown as WebSocket);
  await client.connect('ws://127.0.0.1', 'password');
  assert.equal(socket.sent[0].op, 1);
  assert.equal(
    socket.sent[0].d.authentication,
    authenticationResponse('password', 'salt', 'challenge'),
  );
  assert.deepEqual(await client.call('GetStreamStatus'), { outputActive: false });
  await assert.rejects(client.call('StartStream'), /failed \(500\)/);
  socket.respond = false;
  const pending = client.call('GetStreamStatus');
  socket.close();
  await assert.rejects(pending, /disconnected before responding/);
  await assert.rejects(client.call('GetStreamStatus'), /disconnected/);
});
test('native OBS times out unanswered requests', async () => {
  const socket = new FakeSocket();
  const client = new NativeObsClient(10, () => socket as unknown as WebSocket);
  await client.connect('ws://127.0.0.1');
  socket.respond = false;
  await assert.rejects(client.call('GetStreamStatus'), /timed out/);
  await client.disconnect();
});

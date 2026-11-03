import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect } from 'node:net';
import { WebSocket } from 'ws';
import { OverlayServer } from './index.ts';

test('overlay rejects unauthorized reads and writes, validates and replays state with browser acknowledgement', async (t) => {
  const server = new OverlayServer({ port: 0 });
  try {
    await server.start();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip(
        'Sandbox forbids loopback sockets; run on a desktop for the network integration check.',
      );
      return;
    }
    throw error;
  }
  try {
    const url = new URL(server.url);
    assert.equal((await fetch(url.origin)).status, 403);
    assert.equal(
      (await fetch(server.url, { method: 'POST', body: '{"type":"SHOW_BANNER"}' })).status,
      405,
    );
    const html = await (await fetch(server.url)).text();
    assert.ok(html.includes('text.textContent=m.text'));
    await assert.rejects(server.publish({ type: 'SHOW_COUNTDOWN', seconds: -1 }));
    await server.publish({ type: 'SHOW_BANNER', text: '<img src=x onerror=alert(1)>' });
    const ws = new WebSocket(server.url.replace('http:', 'ws:').replace('/?', '/ws?'));
    const [raw] = await once(ws, 'message');
    const packet = JSON.parse(String(raw));
    assert.equal(packet.message.text, '<img src=x onerror=alert(1)>');
    assert.equal(packet.revision, 1);
    ws.send(JSON.stringify({ ack: 1 }));
    for (let i = 0; i < 100 && server.verification.acknowledgedRevision !== 1; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(server.verification.acknowledgedRevision, 1);
    const state = server.state!;
    state.text = 'mutated';
    assert.notEqual(server.state?.text, 'mutated');
    ws.close();
    await once(ws, 'close');
  } finally {
    await server.close();
  }
});


test('a malformed WebSocket upgrade cannot crash the overlay server', async () => {
  const server = new OverlayServer({ port: 0 });
  await server.start();
  try {
    const url = new URL(server.url);
    const socket = connect(Number(url.port), '127.0.0.1');
    await once(socket, 'connect');
    const closed = once(socket, 'close');
    socket.write(`GET //[ HTTP/1.1\r\nHost: ${url.host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
    await closed;
    assert.equal((await fetch(server.url)).status, 200);
  } finally {
    await server.close();
  }
});

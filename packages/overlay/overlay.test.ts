import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { OverlayServer } from './index.ts';

test('overlay rejects unauthorized reads and writes, validates and replays state with browser acknowledgement', async (t) => {
  const server = new OverlayServer({port:0});
  try { await server.start(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Sandbox forbids loopback sockets; run on a desktop for the network integration check.'); return; }
    throw error;
  }
  try {
    const url = new URL(server.url);
    assert.equal((await fetch(url.origin)).status,403);
    assert.equal((await fetch(server.url,{method:'POST',body:'{"type":"SHOW_BANNER"}'})).status,405);
    const html = await (await fetch(server.url)).text();
    assert.ok(html.includes('text.textContent=m.text'));
    await assert.rejects(server.publish({type:'SHOW_COUNTDOWN',seconds:-1}));
    await server.publish({type:'SHOW_BANNER',text:'<img src=x onerror=alert(1)>'});
    const ws = new WebSocket(server.url.replace('http:', 'ws:').replace('/?','/ws?'));
    const [raw] = await once(ws,'message');
    const packet = JSON.parse(String(raw));
    assert.equal(packet.message.text,'<img src=x onerror=alert(1)>');
    assert.equal(packet.revision,1);
    ws.send(JSON.stringify({ack:1}));
    for(let i=0;i<100 && server.verification.acknowledgedRevision!==1;i++) await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(server.verification.acknowledgedRevision,1);
    const state = server.state!; state.text='mutated';
    assert.notEqual(server.state?.text,'mutated');
    ws.close(); await once(ws,'close');
  } finally { await server.close(); }
});

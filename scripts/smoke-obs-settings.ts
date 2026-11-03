import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { _electron } from 'playwright';
import electronPath from 'electron';
import { authenticationResponse } from '../packages/obs/transport.ts';

// Exercise password entry and retry against an isolated authenticated OBS protocol fixture.
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address !== 'string');
const password = 'isolated-obs-test-password';
server.on('connection', socket => {
  socket.send(JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: { salt: 'test-salt', challenge: 'test-challenge' } } }));
  socket.on('message', raw => {
    const packet = JSON.parse(raw.toString());
    if (packet.op === 1) {
      if (packet.d.authentication !== authenticationResponse(password, 'test-salt', 'test-challenge')) {
        socket.close(4009, 'Authentication failed');
      } else socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
    }
    if (packet.op === 6) {
      const data: Record<string, unknown> = {
        GetSceneList: { scenes: [{ sceneName: 'Connection test' }] },
        GetCurrentProgramScene: { currentProgramSceneName: 'Connection test' },
        GetStreamStatus: { outputActive: false },
      };
      assert.ok(packet.d.requestType in data, 'Only read-only OBS requests are expected.');
      socket.send(JSON.stringify({ op: 7, d: { requestId: packet.d.requestId, requestType: packet.d.requestType,
        requestStatus: { result: true, code: 100 }, responseData: data[packet.d.requestType] } }));
    }
  });
});
const scratch = await mkdtemp(path.join(tmpdir(), 'cue-obs-settings-'));
const bootstrap = path.join(scratch, 'bootstrap.cjs');
await writeFile(bootstrap, `const { app } = require('electron');\napp.setPath('userData', ${JSON.stringify(path.join(scratch, 'profile'))});\nimport(${JSON.stringify(pathToFileURL(path.resolve('dist-electron/main.js')).href)});\n`);
const env: Record<string, string> = { ...process.env, CUE_DEMO_MODE: 'true', CUE_OVERLAY_PORT: '0' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CUE_DEV_URL;
const app = await _electron.launch({ executablePath: electronPath as unknown as string, args: [bootstrap], env });
const page = await app.firstWindow();
page.setDefaultTimeout(10000);
try {
  await page.waitForFunction(() => Boolean(window.cue));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const field = page.getByLabel('WebSocket password', { exact: true });
  await field.fill('demo-password');
  await page.getByRole('checkbox', { name: /^Demo Mode/ }).uncheck();
  await page.waitForFunction(async () => !(await window.cue!.getSnapshot()).settings.demo);
  await field.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.activeElement?.id === 'obs-websocket-password');
  assert.equal(await field.inputValue(), '', 'Changing modes must clear a stale demo password.');
  await field.press('ControlOrMeta+A');
  await field.pressSequentially('wrong-password', { delay: 30 });
  assert.equal(await field.inputValue(), 'wrong-password');
  await page.getByLabel('Port', { exact: true }).fill(String(address.port));
  await page.getByRole('button', { name: 'Connect OBS', exact: true }).click();
  await page.getByText('Could not connect to OBS.', { exact: false }).waitFor();
  assert.equal(await field.inputValue(), 'wrong-password', 'Failed authentication must keep the editable password.');
  await page.waitForFunction(() => document.activeElement?.id === 'obs-websocket-password');
  await field.press('ControlOrMeta+A');
  await field.pressSequentially(password, { delay: 30 });
  assert.equal(await field.inputValue(), password);
  const show = page.getByRole('button', { name: 'Show password', exact: true });
  assert.equal(await field.evaluate(element => document.activeElement === element), true, 'A failed connection must return focus to the password.');
  await show.click();
  assert.equal(await field.getAttribute('type'), 'text');
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  assert.equal(await field.getAttribute('type'), 'password');
  await page.getByRole('button', { name: 'Connect OBS', exact: true }).click();
  await page.waitForFunction(async () => (await window.cue!.getSnapshot()).obs.connected);
  assert.equal(await field.inputValue(), '', 'A successful connection clears the form password.');
  await page.getByRole('button', { name: 'Disconnect OBS', exact: true }).click();
  await page.waitForFunction(async () => !(await window.cue!.getSnapshot()).obs.connected);
  await field.fill('retry-after-disconnect');
  assert.equal(await field.inputValue(), 'retry-after-disconnect');
  await page.screenshot({ path: path.join(scratch, 'obs-settings.png') });
  console.log('OBS settings check passed: Demo Mode transition, typing, failed authentication, password retry, connection and disconnect.');
  console.log(`Screenshot: ${scratch}/obs-settings.png`);
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
  await app.close();
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

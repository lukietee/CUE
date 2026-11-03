import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { _electron, type ElectronApplication } from 'playwright';
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
const rememberConnections = process.env.CUE_REMEMBER_CONNECTIONS === 'true';
const env: Record<string, string> = { ...process.env, CUE_DEMO_MODE: 'true', CUE_OVERLAY_PORT: '0', CUE_REMEMBER_CONNECTIONS: String(rememberConnections) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CUE_DEV_URL;
let app: ElectronApplication | undefined;
async function launch() {
  app = await _electron.launch({ executablePath: electronPath as unknown as string, args: [bootstrap], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.waitForFunction(() => Boolean(window.cue));
  return page;
}
async function closeApp() {
  const current = app;
  app = undefined;
  if (!current) return;
  await current.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
  await current.close().catch(() => {});
}
try {
  let page = await launch();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  let field = page.getByLabel('WebSocket password', { exact: true });
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
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('#obs-websocket-password')?.value === '');
  assert.equal(await field.inputValue(), '', 'A successful connection clears the form password.');
  // Keychain-backed persistence is tested only after an explicit shell opt-in.
  const encryptionAvailable = rememberConnections && await app!.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable());
  const setup = await page.evaluate(() => window.cue!.getSetupStatus());
  assert.equal(setup.rememberConnections, rememberConnections);
  assert.equal(setup.obsCredentialsSaved, encryptionAvailable);
  assert.equal(setup.obsHost, '127.0.0.1');
  assert.equal(setup.obsPort, address.port);
  if (encryptionAvailable) {
    const credentials = path.join(scratch, 'profile', 'obs-credentials.enc');
    assert.equal((await readFile(credentials)).includes(Buffer.from(password)), false, 'Saved credentials must not contain the plaintext password.');
    if (process.platform !== 'win32') assert.equal((await stat(credentials)).mode & 0o777, 0o600);
    await closeApp();
    page = await launch();
    await page.waitForFunction(async () => (await window.cue!.getSnapshot()).obs.connected);
    assert.equal(await page.evaluate(async () => (await window.cue!.getSnapshot()).settings.demo), false);
    const restored = await page.evaluate(() => window.cue!.getSetupStatus());
    assert.equal(restored.rememberConnections, true);
    assert.equal(restored.obsCredentialsSaved, true);
    assert.equal(restored.obsHost, '127.0.0.1');
    assert.equal(restored.obsPort, address.port);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    field = page.getByLabel('WebSocket password', { exact: true });
    assert.equal(await field.inputValue(), '', 'Automatic reconnection must not expose the saved password.');
    assert.equal(await page.getByLabel('Host', { exact: true }).inputValue(), '127.0.0.1');
    assert.equal(await page.getByLabel('Port', { exact: true }).inputValue(), String(address.port));
    console.log('Encrypted OBS credentials survived restart and reconnected without exposing the password.');
  } else if (rememberConnections) {
    console.log('OS credential encryption unavailable; connection retry passed, persistence checks skipped.');
  } else {
    const credentials = path.join(scratch, 'profile', 'obs-credentials.enc');
    await assert.rejects(readFile(credentials), { code: 'ENOENT' });
    await closeApp();
    page = await launch();
    assert.equal(await page.evaluate(async () => (await window.cue!.getSnapshot()).settings.demo), false);
    assert.equal(await page.evaluate(async () => (await window.cue!.getSnapshot()).obs.connected), false, 'Memory-only connections must require reconnection after restart.');
    const restored = await page.evaluate(() => window.cue!.getSetupStatus());
    assert.equal(restored.rememberConnections, false);
    assert.equal(restored.obsCredentialsSaved, false);
    await assert.rejects(readFile(credentials), { code: 'ENOENT' });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    field = page.getByLabel('WebSocket password', { exact: true });
    assert.equal(await field.inputValue(), '');
    await page.getByLabel('Port', { exact: true }).fill(String(address.port));
    await page.getByRole('button', { name: 'Connect OBS', exact: true }).click();
    await page.getByText('Could not connect to OBS.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(async () => (await window.cue!.getSnapshot()).obs.connected), false, 'A restart must not reuse a memory-only password.');
    await field.fill(password);
    await page.getByRole('button', { name: 'Connect OBS', exact: true }).click();
    await page.waitForFunction(async () => (await window.cue!.getSnapshot()).obs.connected);
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('#obs-websocket-password')?.value === '');
    assert.equal(await page.evaluate(async () => (await window.cue!.getSetupStatus()).obsCredentialsSaved), false);
    await assert.rejects(readFile(credentials), { code: 'ENOENT' });
    console.log('Default memory-only mode wrote no credentials and required the password again after restart.');
  }
  await page.getByRole('button', { name: 'Disconnect OBS', exact: true }).click();
  await page.waitForFunction(async () => !(await window.cue!.getSnapshot()).obs.connected);
  await page.waitForFunction(async () => !(await window.cue!.getSetupStatus()).obsCredentialsSaved);
  assert.equal(await page.evaluate(async () => (await window.cue!.getSetupStatus()).obsCredentialsSaved), false, 'Manual disconnect must forget saved credentials.');
  await assert.rejects(readFile(path.join(scratch, 'profile', 'obs-credentials.enc')), { code: 'ENOENT' });
  await field.fill('retry-after-disconnect');
  assert.equal(await field.inputValue(), 'retry-after-disconnect');
  await page.screenshot({ path: path.join(scratch, 'obs-settings.png') });
  console.log('OBS settings check passed: Demo Mode transition, typing, failed authentication, password retry, connection and disconnect.');
  console.log(`Screenshot: ${scratch}/obs-settings.png`);
} finally {
  await closeApp();
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(path.join(scratch, 'profile'), { recursive: true, force: true });
}

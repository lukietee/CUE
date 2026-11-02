import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright';
import electronPath from 'electron';

// This check uses real Electron, preload IPC, core, SQLite and the local overlay server.
// All session state lives in a disposable directory. It never opens a real broadcast.
const scratch = await mkdtemp(path.join(tmpdir(), 'cue-desktop-check-'));
const screenshots = path.resolve(process.env.CUE_SCREENSHOT_DIR ?? path.join(scratch, 'screenshots'));
await mkdir(screenshots, { recursive: true });
const bootstrap = path.join(scratch, 'bootstrap.cjs');
await writeFile(bootstrap, `const { app } = require('electron');\napp.setPath('userData', ${JSON.stringify(path.join(scratch, 'profile'))});\nimport(${JSON.stringify(pathToFileURL(path.resolve('dist-electron/main.js')).href)});\n`);
const environment: Record<string, string> = { ...process.env, CUE_DEMO_MODE: 'true', CUE_OVERLAY_PORT: '0' };
delete environment.CUE_DEV_URL;
delete environment.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({
  executablePath: electronPath as unknown as string,
  args: [bootstrap],
  env: environment,
});
const page = await application.firstWindow();
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(15_000);
const shot = async (name: string) => {
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true });
};
const snapshot = () => page.evaluate(() => window.cue!.getSnapshot());
try {
  await page.waitForFunction(() => Boolean(window.cue));
  assert.equal((await snapshot()).settings.demo, true);
  assert.equal((await snapshot()).status, 'draft');
  // Only this isolated Demo Mode instance auto-accepts native confirmations.
  await application.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    dialog.showMessageBoxSync = () => 1;
  });
  const browserWindow = await application.browserWindow(page);
  await browserWindow.evaluate((win) => win.setContentSize(1440, 1000));
  await page.getByLabel('Describe your stream').waitFor();
  await shot('studio');
  await page.getByLabel('Describe your stream').fill('A city walk where chat picks the next challenge');
  await page.getByRole('button', { name: /Make a plan|Create (a )?(stream )?plan|Build.*plan/i }).click();
  await page.getByRole('button', { name: 'Connect Twitch', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Connect Twitch', exact: true }).click();
  await page.waitForFunction(async () => (await window.cue!.getSnapshot()).twitch.connected);
  await page.getByRole('button', { name: 'Connect OBS', exact: true }).click();
  await page.waitForFunction(async () => (await window.cue!.getSnapshot()).obs.connected);
  await page.getByRole('button', { name: 'Stage in OBS', exact: true }).click();
  await page.waitForFunction(async () => (await window.cue!.getSnapshot()).overlay.staged);
  await shot('plan');
  await page.getByRole('button', { name: /Ready\? Go live|Go live/i }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal((await snapshot()).obs.streaming, false, 'Opening a confirmation must not start output');
  await page.getByRole('button', { name: 'Yes, go live', exact: true }).click();
  await page.waitForFunction(async () => (await window.cue!.getSnapshot()).status === 'live');
  await page.getByRole('button', { name: /Inject chat spike/i }).click();
  await page.waitForFunction(async () => (await window.cue!.getSnapshot()).actions.some((a) => a.status === 'succeeded'));
  await shot('live');
  await page.getByRole('button', { name: 'Pause Director', exact: true }).click();
  await page.waitForFunction(async () => (await window.cue!.getSnapshot()).paused);
  const actions = (await snapshot()).actions.length;
  await page.getByRole('button', { name: /Inject chat spike/i }).click();
  assert.equal((await snapshot()).actions.length, actions, 'Pause must prevent automatic actions');
  await page.getByRole('button', { name: 'End stream', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'End stream', exact: true }).click();
  await page.waitForFunction(async () => (await window.cue!.getSnapshot()).status === 'ended');
  await page.getByRole('button', { name: 'Markdown', exact: true }).waitFor();
  await shot('recap');
  const exportPath = path.join(scratch, 'cue-recap.md');
  await application.evaluate(({ session }, savePath) => {
    session.defaultSession.once('will-download', (_event, item) => item.setSavePath(savePath));
  }, exportPath);
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const deadline = Date.now() + 10000;
  let exported = '';
  while (Date.now() < deadline) {
    exported = await readFile(exportPath, 'utf8').catch(() => '');
    if (exported.includes('# ')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.match(exported, /# /, 'Markdown export must save a real recap file');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await shot('settings');
  await browserWindow.evaluate((win) => { win.setMinimumSize(360, 600); win.setContentSize(760, 900); });
  await shot('settings-compact');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false, 'Compact layout must not scroll horizontally');
  assert.deepEqual(errors, []);
  console.log('Desktop check passed: real IPC demo journey, confirmation, cue, pause, recap export and compact settings.');
  console.log(`Screenshots: ${screenshots}`);
} finally {
  // Destroy only disposable test windows, including if an assertion failed mid-session.
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((win) => win.destroy())).catch(() => {});
  await application.close().catch(() => {});
  // Keep screenshots for visual review; remove only the disposable user profile after closing.
  await rm(path.join(scratch, 'profile'), { recursive: true, force: true });
}

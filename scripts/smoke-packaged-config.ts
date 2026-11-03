import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { _electron } from 'playwright';
const bundle = path.resolve(process.argv.find(arg => arg.startsWith('--app='))?.slice(6) ?? `release/CUE-darwin-${process.arch}/CUE.app`);
const executablePath = path.join(bundle, 'Contents/MacOS/CUE');
const scratch = await mkdtemp(path.join(tmpdir(), 'cue-packaged-config-'));
const profile = path.join(scratch, 'profile');
await mkdir(profile);
await writeFile(path.join(profile, 'config.env'), 'TWITCH_CLIENT_ID=test-public-client\nOPENAI_API_KEY=test-config-only-key\nOPENAI_MODEL=gpt-4o-mini\nCUE_DEMO_MODE=true\nCUE_OVERLAY_PORT=0\n', { mode: 0o600 });
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
for (const key of ['TWITCH_CLIENT_ID', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'CUE_DEMO_MODE', 'CUE_OVERLAY_PORT', 'CUE_CONFIG_PATH', 'CUE_DEV_URL', 'ELECTRON_RUN_AS_NODE']) delete env[key];
const args = [`--user-data-dir=${profile}`];
const app = await _electron.launch({ executablePath, args, env, cwd: '/' });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.cue));
  const setup = await page.evaluate(() => window.cue!.getSetupStatus());
  assert.equal(setup.twitchConfigured, true);
  assert.equal(setup.plannerConfigured, true);
  assert.equal(setup.plannerModel, 'gpt-4o-mini');
  assert.equal((await page.evaluate(() => window.cue!.getSnapshot())).settings.demo, true);
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  const child = spawn(executablePath, args, { cwd: '/', env, stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(Error('Second app launch did not exit.')); }, 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(Error(`Second launch exited ${code}`)); });
  });
  assert.equal((await page.evaluate(() => window.cue!.getSetupStatus())).twitchConfigured, true);
  console.log('Packaged config check passed: Finder-style working directory, private per-user config, isolated profile, and repeated launch focuses the original app.');
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
  await app.close();
  await rm(scratch, { recursive: true, force: true });
}

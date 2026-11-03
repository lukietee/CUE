import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { exportConfiguration } from '../packages/desktop/configuration.ts';
const execute = promisify(execFile);
if (process.platform !== 'darwin') throw Error('This installer requires macOS.');
const source = path.resolve(`release/CUE-darwin-${process.arch}/CUE.app`);
if (!existsSync(source)) throw Error('Run npm run package:mac first.');
const applications = path.join(homedir(), 'Applications');
const installed = path.join(applications, 'CUE.app');
const legacy = path.join(homedir(), 'Library/Application Support/Electron');
const userData = existsSync(path.join(legacy, 'cue.sqlite')) ? legacy : path.join(homedir(), 'Library/Application Support/CUE');
const database = path.join(userData, 'cue.sqlite');
if (existsSync(database)) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const row = db.prepare('SELECT snapshot FROM sessions ORDER BY rowid DESC LIMIT 1').get() as { snapshot: string } | undefined;
    if (row && JSON.parse(row.snapshot).status === 'live') throw Error('End the active CUE session before installing an update. OBS is not stopped by this installer.');
  } finally { db.close(); }
}
await mkdir(applications, { recursive: true });
if (existsSync(installed)) {
  const match = '^' + path.join(installed, 'Contents/MacOS/CUE').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  const wasRunning = await execute('pgrep', ['-f', match]).then(() => true, () => false);
  if (wasRunning) await execute('osascript', ['-e', `tell application ${JSON.stringify(installed)} to quit`]);
  for (let attempt = 0; ; attempt++) {
    const running = await execute('pgrep', ['-f', match]).then(() => true, () => false);
    if (!running) break;
    if (attempt >= 50) throw Error('Close CUE before installing the update.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const backups = path.join(applications, 'CUE-backups');
  await mkdir(backups, { recursive: true });
  await rename(installed, path.join(backups, `CUE-${new Date().toISOString().replace(/[:.]/g, '-')}.app`));
}
await execute('ditto', [source, installed]);
if (existsSync('.env')) {
  await mkdir(userData, { recursive: true, mode: 0o700 });
  const configuration = path.join(userData, 'config.env');
  await writeFile(configuration, exportConfiguration(await readFile('.env', 'utf8')), { mode: 0o600 });
  await chmod(configuration, 0o600);
  console.log('Installed per-user runtime configuration; credentials were not included in the app bundle.');
}
console.log(`Installed ${installed}`);
console.log('Open CUE from Finder. Connections are session-only by default; remembering them is an optional Settings choice.');

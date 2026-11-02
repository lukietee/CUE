import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { build } from 'esbuild';
const server = await createServer();
await server.listen();
await build({
  entryPoints: ['apps/desktop/electron/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: 'dist-electron/main.js',
});
await build({
  entryPoints: ['apps/desktop/electron/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: 'dist-electron/preload.cjs',
});
const electron = (await import('electron')).default as unknown as string;
const child = spawn(electron, ['dist-electron/main.js'], {
  stdio: 'inherit',
  env: { ...process.env, CUE_DEV_URL: 'http://127.0.0.1:5173' },
});
const stop = async () => {
  child.kill();
  await server.close();
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

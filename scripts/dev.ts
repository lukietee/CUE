import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { build } from 'esbuild';
import { normalizeRendererEntryUrl } from '../packages/shared/navigation.ts';

// Resolve every input from this checkout, even when invoked from a different working directory.
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
process.chdir(projectRoot);
const server = await createServer({ configFile: path.join(projectRoot, 'vite.config.ts') });
let child: ChildProcess | undefined;
let shutdown: Promise<void> | undefined;
const stop = (code: number, terminateChild = true) => {
  if (shutdown) return shutdown;
  shutdown = (async () => {
    process.exitCode = code;
    if (terminateChild && child && child.exitCode === null && !child.killed) child.kill('SIGTERM');
    await server.close();
  })();
  return shutdown;
};
process.once('SIGINT', () => void stop(130));
process.once('SIGTERM', () => void stop(143));
try {
  await server.listen();
  const entry = server.resolvedUrls?.local[0];
  if (!entry) throw new Error('Vite did not expose a local renderer entry URL.');
  const rendererUrl = normalizeRendererEntryUrl(entry);
  await Promise.all([
    build({
      entryPoints: ['apps/desktop/electron/main.ts'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      outfile: 'dist-electron/main.js',
    }),
    build({
      entryPoints: ['apps/desktop/electron/preload.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      outfile: 'dist-electron/preload.cjs',
    }),
  ]);
  if (!shutdown) {
    const electron = (await import('electron')).default as unknown as string;
    if (shutdown) throw new Error('Development startup cancelled.');
    const environment = { ...process.env, CUE_DEV_URL: rendererUrl };
    // A parent Node launcher must not make Electron run in Node-only mode.
    delete (environment as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
    child = spawn(electron, [path.join(projectRoot, 'dist-electron/main.js')], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: environment,
    });
    child.once('error', (error) => {
      console.error('CUE desktop failed to launch:', error.message);
      void stop(1);
    });
    child.once('exit', (code, signal) => {
      void stop(code ?? (signal ? 1 : 0), false);
    });
    console.log(`CUE renderer: ${rendererUrl}`);
    console.log('Renderer edits reload automatically. Restart npm run dev after main/preload changes.');
  }
} catch (error) {
  console.error('CUE development startup failed:', error instanceof Error ? error.message : error);
  await stop(1);
}

import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, nativeTheme } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { ModelPlanner } from '../../../packages/agent/provider.ts';
import { CueService } from '../../../packages/core/index.ts';
import { Storage } from '../../../packages/storage/index.ts';
import {
  RealTwitchAdapter,
  MockTwitchAdapter,
  type TokenStore,
  type TwitchTokens,
} from '../../../packages/twitch/index.ts';
import { RealObsAdapter, MockObsAdapter } from '../../../packages/obs/index.ts';
import { OverlayServer } from '../../../packages/overlay/index.ts';
import {
  PlanSchema,
  ModeSchema,
  type TwitchAdapter,
  type ObsAdapter,
} from '../../../packages/shared/index.ts';
try {
  process.loadEnvFile();
} catch {
  /* .env is optional */
}
// Keep existing sessions and encrypted credentials in the same directory when
// giving the development app its product name (the default is often Electron).
const existingUserData = app.getPath('userData');
app.setName('CUE');
app.setPath('userData', existingUserData);
nativeTheme.themeSource = 'light';
const dirname = path.dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow;
let service: CueService;
let overlay: OverlayServer;
let store: Storage;
let twitch: TwitchAdapter;
let obs: ObsAdapter;
let realObsConfig = { host: '127.0.0.1', port: 4455, password: '' };
let modeChanging = false;
let healthTimer: ReturnType<typeof setInterval> | undefined;
const ObsConfig = z
  .object({
    host: z
      .string()
      .refine(
        (h) => ['127.0.0.1', 'localhost', '::1'].includes(h),
        'OBS must run on this computer',
      ),
    port: z.number().int().min(1).max(65535),
    password: z.string().max(1000),
  })
  .strict();
function tokenStore(): TokenStore {
  const filename = path.join(app.getPath('userData'), 'twitch-credentials.enc');
  return {
    async load() {
      try {
        if (!safeStorage.isEncryptionAvailable()) return null;
        return JSON.parse(safeStorage.decryptString(await readFile(filename))) as TwitchTokens;
      } catch {
        return null;
      }
    },
    async save(tokens) {
      if (!safeStorage.isEncryptionAvailable()) return;
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, safeStorage.encryptString(JSON.stringify(tokens)), { mode: 0o600 });
    },
    async clear() {
      await unlink(filename).catch(() => {});
    },
  };
}
function adapters(demo: boolean) {
  twitch = demo
    ? new MockTwitchAdapter()
    : new RealTwitchAdapter({
        clientId: process.env.TWITCH_CLIENT_ID ?? '',
        tokenStore: tokenStore(),
        openExternal: async (url) => {
          const u = new URL(url);
          if (
            u.protocol !== 'https:' ||
            !['www.twitch.tv', 'twitch.tv', 'id.twitch.tv'].includes(u.hostname)
          )
            throw Error('Unexpected authorization URL');
          await shell.openExternal(url);
        },
        onAuthorization: (info) =>
          service.event('twitch.authorization', {
            userCode: info.userCode,
            verificationUri: info.verificationUri,
          }),
        onStatus: (message) => service.event('twitch.status', { message }),
        onError: (error) => {
          service.state.twitch.connected = false;
          service.reportError(error);
        },
      });
  obs = demo
    ? new MockObsAdapter()
    : new RealObsAdapter({
        ...realObsConfig,
        onConnectionChange: (connected: boolean) => {
          if (service && !connected) {
            service.state.obs.connected = false;
            service.reportError('OBS disconnected. Reconnect in Settings.');
          }
        },
      });
  return { twitch, obs };
}
function bind(channel: string, schema: z.ZodType<any[]>, handler: (...args: any[]) => unknown) {
  ipcMain.handle(`cue:${channel}`, async (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
      throw Error('Unauthorized IPC sender');
    try {
      return await handler(...schema.parse(args));
    } catch (error) {
      try {
        service.reportError(error);
      } catch {}
      throw Error(error instanceof Error ? error.message : 'Operation failed');
    }
  });
}
async function boot() {
  await app.whenReady();
  overlay = new OverlayServer({ port: Number(process.env.CUE_OVERLAY_PORT ?? 4318) });
  await overlay.start();
  store = new Storage(path.join(app.getPath('userData'), 'cue.sqlite'));
  const saved = store.latest();
  const demo = saved?.settings.demo ?? process.env.CUE_DEMO_MODE !== 'false';
  service = new CueService({
    store,
    overlay,
    ...adapters(demo),
    planner: process.env.OPENAI_API_KEY
      ? new ModelPlanner({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL })
      : undefined,
  });
  service.state.settings.demo = demo;
  win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 720,
    show: false,
    backgroundColor: '#f6f8f5',
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 20, y: 18 },
          roundedCorners: true,
        }
      : {}),
    title: 'CUE · Your stream. Right on cue.',
    webPreferences: {
      preload: path.join(dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.CUE_DEV_URL ?? new URL('../dist/index.html', import.meta.url).href;
    if (url !== allowed) event.preventDefault();
  });
  service.on('snapshot', (snapshot) => {
    if (!win.isDestroyed()) win.webContents.send('cue:snapshot', snapshot);
  });
  service.on('event', (event) => {
    if (!win.isDestroyed()) win.webContents.send('cue:event', event);
  });
  const none = z.tuple([]);
  bind('getSnapshot', none, () => service.snapshot());
  bind('createPlan', z.tuple([z.string().min(3).max(4000), ModeSchema]), (brief, mode) =>
    service.createPlan(brief, mode),
  );
  bind('savePlan', z.tuple([PlanSchema]), (plan) => service.savePlan(plan));
  bind('connectTwitch', none, () => service.connectTwitch());
  bind('connectObs', z.tuple([ObsConfig]), async (config) => {
    if (!service.state.settings.demo) {
      if (service.state.status === 'live' && service.state.obs.connected)
        throw Error('End the session before reconfiguring connected OBS');
      await obs.disconnect();
      realObsConfig = config;
      obs = new RealObsAdapter({
        ...config,
        onConnectionChange: (connected) => {
          if (!connected) {
            service.state.obs.connected = false;
            service.reportError('OBS disconnected');
          }
        },
      });
      await service.replaceAdapters({ obs });
    }
    await service.connectObs();
  });
  bind('checkReadiness', none, () => service.checkReadiness());
  bind('applyMetadata', z.tuple([z.string()]), (id) => service.applyMetadata(id));
  bind('stageOverlay', none, () => service.stageOverlay());
  bind('requestConfirmation', z.tuple([z.enum(['start', 'stop'])]), async (operation) => {
    const result = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', operation === 'start' ? 'Start stream' : 'End stream'],
      defaultId: 0,
      cancelId: 0,
      title: service.state.settings.demo
        ? 'Confirm demo stream'
        : `Confirm ${operation === 'start' ? 'Go Live' : 'End Stream'}`,
      message:
        operation === 'start'
          ? service.state.settings.demo
            ? 'Start the simulated demo stream?'
            : 'Start broadcasting publicly through OBS?'
          : service.state.settings.demo
            ? 'End the simulated stream?'
            : 'Stop your active OBS broadcast?',
      detail: 'CUE requires your confirmation for every stream start and stop.',
    });
    if (result.response !== 1) throw Error('Stream confirmation cancelled');
    return service.requestConfirmation(operation);
  });
  bind('startStream', z.tuple([z.string()]), (token) => service.startStream(token));
  bind('endStream', z.tuple([z.string()]), (token) => service.endStream(token));
  bind('pauseDirector', z.tuple([z.boolean()]), (paused) => service.pauseDirector(paused));
  bind('getRecap', z.tuple([z.string()]), (id) => service.getRecap(id));
  const settings = z
    .object({
      demo: z.boolean().optional(),
      overlays: z.boolean().optional(),
      sceneSwitching: z.boolean().optional(),
      cooldownSec: z.number().int().min(10).max(600).optional(),
      mode: ModeSchema.optional(),
    })
    .strict();
  bind('updateSettings', z.tuple([settings]), async (patch) => {
    if (modeChanging) throw Error('Mode change already in progress');
    if (patch.demo !== undefined && patch.demo !== service.state.settings.demo) {
      if (service.state.status === 'live') throw Error('End the stream before changing Demo Mode');
      modeChanging = true;
      try {
        await service.disconnect('twitch');
        await service.disconnect('obs');
        await service.replaceAdapters(adapters(patch.demo));
        service.state.settings.demo = patch.demo;
        service.state.overlay.staged = false;
        await overlay.publish({ type: 'HIDE_BANNER' });
      } finally {
        modeChanging = false;
      }
    }
    await service.updateSettings(patch);
  });
  bind('sendMessage', z.tuple([z.string().min(1).max(2000)]), (text) => service.sendMessage(text));
  bind('injectDemo', none, () => service.injectDemo());
  bind('deleteHistory', none, () => service.deleteHistory());
  bind('disconnect', z.tuple([z.enum(['twitch', 'obs'])]), (s) => service.disconnect(s));
  if (process.env.CUE_DEV_URL) await win.loadURL(process.env.CUE_DEV_URL);
  else await win.loadFile(path.join(dirname, '../dist/index.html'));
  let checking = false;
  healthTimer = setInterval(() => {
    if (checking || modeChanging) return;
    checking = true;
    void service.refreshProductionState().finally(() => {
      checking = false;
    });
  }, 3000);
  win.on('close', (event) => {
    if (service.state.status === 'live') {
      const result = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Keep CUE open', 'Quit CUE'],
        defaultId: 0,
        cancelId: 0,
        message: 'Your stream is still active.',
        detail:
          'Quitting CUE pauses production automation. It does not stop OBS. End the stream in CUE or OBS first.',
      });
      if (result === 0) {
        event.preventDefault();
        return;
      }
      service.pauseDirector(true);
    }
  });
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  clearInterval(healthTimer);
  store?.close();
  void overlay?.close();
});
boot().catch((error) => {
  console.error(error);
  dialog.showErrorBox(
    'CUE could not start',
    error instanceof Error ? error.message : String(error),
  );
  app.quit();
});

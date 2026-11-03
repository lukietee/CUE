import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, nativeTheme } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadConfiguration } from '../../../packages/desktop/configuration.ts';
import { z } from 'zod';
import { ModelPlanner } from '../../../packages/agent/provider.ts';
import {
  normalizeRendererEntryUrl,
  isAllowedRendererNavigation,
} from '../../../packages/shared/navigation.ts';
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
// Keep existing sessions and encrypted credentials in the same directory when
// giving the development app its product name (the default is often Electron).
const legacyUserData = path.join(app.getPath('appData'), 'Electron');
const configuredUserData = app.getPath('userData');
const defaultUserData = path.join(app.getPath('appData'), app.getName());
const existingUserData =
  app.isPackaged &&
  configuredUserData === defaultUserData &&
  existsSync(path.join(legacyUserData, 'cue.sqlite'))
    ? legacyUserData
    : configuredUserData;
app.setName('CUE');
app.setPath('userData', existingUserData);
nativeTheme.themeSource = 'dark';
const dirname = path.dirname(fileURLToPath(import.meta.url));
loadConfiguration({ packaged: app.isPackaged, projectRoot: path.resolve(dirname, '..'),
  userData: app.getPath('userData'), env: process.env });
const rendererEntry = normalizeRendererEntryUrl(
  process.env.CUE_DEV_URL ?? new URL('../dist/index.html', import.meta.url).href,
);
let win: BrowserWindow;
let service: CueService;
let overlay: OverlayServer;
let store: Storage;
let twitch: TwitchAdapter;
let obs: ObsAdapter;
let realObsConfig = { host: '127.0.0.1', port: 4455, password: '' };
let obsCredentialsSaved = false;
let rememberConnections = false;
let encryptionAvailable: boolean | undefined;
let expectedObsDisconnect = false;
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
const obsCredentialsFile = () => path.join(app.getPath('userData'), 'obs-credentials.enc');
const connectionPreferenceFile = () => path.join(app.getPath('userData'), 'connection-preferences.json');
async function loadConnectionPreference() {
  if (process.env.CUE_REMEMBER_CONNECTIONS !== undefined) {
    rememberConnections = process.env.CUE_REMEMBER_CONNECTIONS === 'true';
    return;
  }
  try {
    rememberConnections = JSON.parse(await readFile(connectionPreferenceFile(), 'utf8')).rememberConnections === true;
  } catch { rememberConnections = false; }
}
async function saveConnectionPreference() {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(connectionPreferenceFile(), JSON.stringify({ rememberConnections }), { mode: 0o600 });
}
function secureStorageAvailable() {
  if (!rememberConnections) return false;
  try { return encryptionAvailable ??= safeStorage.isEncryptionAvailable(); }
  catch { return encryptionAvailable = false; }
}
async function loadObsCredentials() {
  if (!secureStorageAvailable()) return;
  try {
    realObsConfig = ObsConfig.parse(JSON.parse(safeStorage.decryptString(await readFile(obsCredentialsFile()))));
    obsCredentialsSaved = true;
  } catch { /* A missing or obsolete saved connection requires manual entry. */ }
}
async function saveObsCredentials() {
  if (!secureStorageAvailable()) return;
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(obsCredentialsFile(), safeStorage.encryptString(JSON.stringify(realObsConfig)), { mode: 0o600 });
  obsCredentialsSaved = true;
}
function obsConnectionChanged(connected: boolean) {
  if (!service || connected) return;
  const wasConnected = service.state.obs.connected;
  service.state.obs.connected = false;
  service.state.obs.streaming = false;
  service.state.overlay.staged = false;
  if (service.state.status === 'live') service.state.paused = true;
  if (!expectedObsDisconnect && wasConnected) service.reportError('OBS disconnected. Reconnect in Settings.');
}
async function disconnectObsAdapter() {
  expectedObsDisconnect = true;
  try { await obs.disconnect(); } finally { expectedObsDisconnect = false; }
}
function tokenStore(): TokenStore {
  const filename = path.join(app.getPath('userData'), 'twitch-credentials.enc');
  return {
    async load() {
      try {
        if (!secureStorageAvailable()) return null;
        return JSON.parse(safeStorage.decryptString(await readFile(filename))) as TwitchTokens;
      } catch {
        return null;
      }
    },
    async save(tokens) {
      if (!secureStorageAvailable()) return;
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
        onConnectionChange: obsConnectionChanged,
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
  await loadConnectionPreference();
  await loadObsCredentials();
  // An operator may supply a connection for this process without storing it.
  if (process.env.CUE_OBS_PASSWORD !== undefined) {
    realObsConfig = ObsConfig.parse({ host: '127.0.0.1', port: Number(process.env.CUE_OBS_PORT || 4455), password: process.env.CUE_OBS_PASSWORD });
  }
  const appIcon = path.join(dirname, '../assets/cue.png');
  if (process.platform === 'darwin') app.dock?.setIcon(appIcon);
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
    backgroundColor: '#0e0e10',
    icon: appIcon,
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
    if (!isAllowedRendererNavigation(url, rendererEntry)) event.preventDefault();
  });
  service.on('snapshot', (snapshot) => {
    if (!win.isDestroyed()) win.webContents.send('cue:snapshot', snapshot);
  });
  service.on('event', (event) => {
    if (!win.isDestroyed()) win.webContents.send('cue:event', event);
  });
  const none = z.tuple([]);
  let rendererInitialized!: () => void;
  const rendererReady = new Promise<void>(resolve => { rendererInitialized = resolve; });
  bind('getSnapshot', none, () => { rendererInitialized(); return service.snapshot(); });
  const setupStatus = () => ({
    twitchConfigured: Boolean(process.env.TWITCH_CLIENT_ID?.trim()),
    plannerConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    plannerModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    obsCredentialsSaved,
    rememberConnections,
    obsHost: realObsConfig.host,
    obsPort: realObsConfig.port,
  });
  bind('getSetupStatus', none, setupStatus);
  bind('setRememberConnections', z.tuple([z.boolean()]), async (enabled) => {
    if (service.state.status === 'live') throw Error('End the session before changing saved connections.');
    rememberConnections = enabled;
    encryptionAvailable = undefined;
    if (enabled && !secureStorageAvailable()) {
      rememberConnections = false;
      await saveConnectionPreference();
      throw Error('Secure storage was not allowed. You can keep using session-only connections.');
    }
    if (!enabled) obsCredentialsSaved = false;
    else if (service.state.obs.connected && !service.state.settings.demo) await saveObsCredentials();
    await saveConnectionPreference();
    return setupStatus();
  });
  bind('createPlan', z.tuple([z.string().min(3).max(4000), ModeSchema]), (brief, mode) =>
    service.createPlan(brief, mode),
  );
  bind('savePlan', z.tuple([PlanSchema]), (plan) => service.savePlan(plan));
  let connectingTwitch: ReturnType<CueService['connectTwitch']> | undefined;
  const connectTwitch = () => connectingTwitch ??= service.connectTwitch().finally(() => { connectingTwitch = undefined; });
  bind('connectTwitch', none, connectTwitch);
  bind('connectObs', z.tuple([ObsConfig]), async (config) => {
    if (service.state.settings.demo) return service.connectObs();
    if (service.state.status === 'live' && service.state.obs.connected)
      throw Error('End the session before reconfiguring connected OBS');
    const sameEndpoint = config.host === realObsConfig.host && config.port === realObsConfig.port;
    const nextConfig = { ...config, password: config.password || ((obsCredentialsSaved || service.state.obs.connected) && sameEndpoint ? realObsConfig.password : '') };
    await disconnectObsAdapter();
    obs = new RealObsAdapter({ ...nextConfig, onConnectionChange: obsConnectionChanged });
    await service.replaceAdapters({ obs });
    await service.connectObs();
    realObsConfig = nextConfig;
    await saveObsCredentials();
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
        expectedObsDisconnect = true;
        try { await service.disconnect('obs'); } finally { expectedObsDisconnect = false; }
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
  bind('disconnect', z.tuple([z.enum(['twitch', 'obs'])]), async (target) => {
    if (target === 'obs') expectedObsDisconnect = true;
    try {
      await service.disconnect(target);
      if (target === 'obs' && !service.state.settings.demo) {
        await unlink(obsCredentialsFile()).catch(() => {});
        obsCredentialsSaved = false;
        realObsConfig = { host: '127.0.0.1', port: 4455, password: '' };
      }
    } finally { expectedObsDisconnect = false; }
  });
  if (process.env.CUE_DEV_URL) await win.loadURL(rendererEntry);
  else await win.loadFile(path.join(dirname, '../dist/index.html'));
  await rendererReady;
  // A cached authorization can reconnect silently; new accounts use Connect Twitch.
  if (!demo && process.env.TWITCH_CLIENT_ID && (process.argv.includes('--connect-twitch') || await tokenStore().load())) {
    void connectTwitch().catch(error => service.reportError(error));
  }
  // Restore connections and refresh the per-launch overlay URL without starting output.
  if (!demo && (obsCredentialsSaved || process.env.CUE_OBS_PASSWORD !== undefined)) {
    try {
      await service.connectObs();
      if (service.state.plan) await service.stageOverlay();
    } catch (error) { service.reportError(error); }
  }
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
const primaryInstance = app.requestSingleInstanceLock();
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
});
if (!primaryInstance) app.quit();
else boot().catch((error) => {
  console.error(error);
  dialog.showErrorBox(
    'CUE could not start',
    error instanceof Error ? error.message : String(error),
  );
  app.quit();
});

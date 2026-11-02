import { NativeObsClient, type ObsClient } from './transport.ts';
import type { ObsAdapter } from '../shared/index.ts';

export type ObsConfig = {
  host?: string;
  port?: number;
  password?: string;
  onConnectionChange?: (connected: boolean) => void;
};
/** Main-process adapter only. Core must authorize start/stop before calling these methods. */
export class RealObsAdapter implements ObsAdapter {
  private connected = false;
  private staging: Promise<void> | null = null;
  constructor(
    private config: ObsConfig = {},
    private client: ObsClient = new NativeObsClient(),
  ) {
    client.on('ConnectionClosed', () => {
      this.connected = false;
      config.onConnectionChange?.(false);
    });
    client.on('ConnectionError', () => {
      this.connected = false;
      config.onConnectionChange?.(false);
    });
  }
  async connect() {
    if (this.connected) return;
    const host = this.config.host ?? '127.0.0.1';
    if (!['127.0.0.1', 'localhost', '::1'].includes(host))
      throw new Error('Only local OBS connections are supported. Use 127.0.0.1.');
    const port = this.config.port ?? 4455;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid OBS port.');
    try {
      await this.client.connect(
        `ws://${host === '::1' ? '[::1]' : host}:${port}`,
        this.config.password,
        { rpcVersion: 1 },
      );
      this.connected = true;
      this.config.onConnectionChange?.(true);
    } catch {
      throw new Error(
        'Could not connect to OBS. Enable Tools → WebSocket Server Settings and check the port and password.',
      );
    }
  }
  private check() {
    if (!this.connected) throw new Error('OBS is disconnected. Reconnect before continuing.');
  }
  async listScenes() {
    this.check();
    const result = await this.client.call('GetSceneList');
    return result.scenes.map((s) => String(s.sceneName));
  }
  async getCurrentScene() {
    this.check();
    return (await this.client.call('GetCurrentProgramScene')).currentProgramSceneName;
  }
  async getStreamStatus() {
    this.check();
    return { active: (await this.client.call('GetStreamStatus')).outputActive };
  }
  async ensureOverlaySource(url: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1')
      throw new Error('CUE overlay must use the local overlay server.');
    this.check();
    if (this.staging) return this.staging;
    this.staging = this.stage(url).finally(() => {
      this.staging = null;
    });
    return this.staging;
  }
  private async stage(url: string) {
    const sceneName = await this.getCurrentScene();
    const inputName = 'CUE Overlay';
    const settings = {
      url,
      width: 1920,
      height: 1080,
      reroute_audio: false,
      shutdown: false,
      restart_when_active: false,
    };
    const { inputs } = await this.client.call('GetInputList');
    const existing = inputs.find((input) => input.inputName === inputName);
    let sceneItemId: number;
    if (existing) {
      if (
        existing.inputKind !== 'browser_source' &&
        existing.unversionedInputKind !== 'browser_source'
      )
        throw new Error(
          'An input named CUE Overlay already exists and is not a browser source. Rename it before staging.',
        );
      await this.client.call('SetInputSettings', {
        inputName,
        inputSettings: settings,
        overlay: true,
      });
      const { sceneItems } = await this.client.call('GetSceneItemList', { sceneName });
      const item = sceneItems.find((item) => item.sourceName === inputName);
      sceneItemId = item
        ? Number(item.sceneItemId)
        : (
            await this.client.call('CreateSceneItem', {
              sceneName,
              sourceName: inputName,
              sceneItemEnabled: true,
            })
          ).sceneItemId;
    } else {
      sceneItemId = (
        await this.client.call('CreateInput', {
          sceneName,
          inputName,
          inputKind: 'browser_source',
          inputSettings: settings,
          sceneItemEnabled: true,
        })
      ).sceneItemId;
    }
    await this.client.call('SetSceneItemEnabled', {
      sceneName,
      sceneItemId,
      sceneItemEnabled: true,
    });
    const { sceneItems } = await this.client.call('GetSceneItemList', { sceneName });
    await this.client.call('SetSceneItemIndex', {
      sceneName,
      sceneItemId,
      sceneItemIndex: Math.max(0, sceneItems.length - 1),
    });
    const { inputSettings } = await this.client.call('GetInputSettings', { inputName });
    if (inputSettings.url !== url)
      throw new Error('OBS did not confirm the overlay URL. Try staging again.');
  }
  async switchScene(sceneName: string) {
    this.check();
    if (!(await this.listScenes()).includes(sceneName))
      throw new Error('The selected OBS scene no longer exists.');
    await this.client.call('SetCurrentProgramScene', { sceneName });
    if ((await this.getCurrentScene()) !== sceneName)
      throw new Error('OBS did not confirm the scene change.');
  }
  async startStream() {
    this.check();
    if (!(await this.getStreamStatus()).active) await this.client.call('StartStream');
  }
  async stopStream() {
    this.check();
    if ((await this.getStreamStatus()).active) await this.client.call('StopStream');
  }
  async disconnect() {
    this.connected = false;
    await this.client.disconnect();
    this.config.onConnectionChange?.(false);
  }
}
export class MockObsAdapter implements ObsAdapter {
  private connected = false;
  private active = false;
  private scene = 'Main stage';
  overlayUrl: string | null = null;
  readonly scenes = ['Main stage', 'Just chatting', 'Be right back'];
  private check() {
    if (!this.connected) throw new Error('Demo OBS is disconnected.');
  }
  async connect() {
    this.connected = true;
  }
  async listScenes() {
    this.check();
    return [...this.scenes];
  }
  async getCurrentScene() {
    this.check();
    return this.scene;
  }
  async getStreamStatus() {
    this.check();
    return { active: this.active };
  }
  async ensureOverlaySource(url: string) {
    this.check();
    this.overlayUrl = url;
  }
  async switchScene(scene: string) {
    this.check();
    if (!this.scenes.includes(scene)) throw new Error('Unknown scene.');
    this.scene = scene;
  }
  async startStream() {
    this.check();
    this.active = true;
  }
  async stopStream() {
    this.check();
    this.active = false;
  }
  async disconnect() {
    this.connected = false;
  }
}

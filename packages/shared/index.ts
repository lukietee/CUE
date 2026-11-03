import { z } from 'zod';
export const ModeSchema = z.enum(['reality_tv', 'documentary', 'chill']);
export type DirectorMode = z.infer<typeof ModeSchema>;
export const PlanSchema = z.object({
  id: z.string(),
  brief: z.string().min(3).max(4000),
  title: z.string().min(1).max(140),
  categoryId: z.string().optional(),
  categoryName: z.string().default('Just Chatting'),
  tags: z.array(z.string().max(25)).max(10),
  mode: ModeSchema,
  segments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().min(1),
        goal: z.string(),
        durationMin: z.number().positive(),
      }),
    )
    .min(1),
});
export type StreamPlan = z.infer<typeof PlanSchema>;
export const EventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  ts: z.string(),
  source: z.enum(['twitch', 'obs', 'vision', 'audio', 'system', 'demo']),
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type DirectorEvent = z.infer<typeof EventSchema>;
export const ActionSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  type: z.enum([
    'overlay.show',
    'overlay.hide',
    'obs.switch_scene',
    'twitch.update_metadata',
    'twitch.create_poll',
    'director.suggest',
    'highlight.mark',
  ]),
  args: z.record(z.string(), z.unknown()),
  reason: z.string(),
  evidenceEventIds: z.array(z.string()),
  risk: z.enum(['low', 'medium', 'high']),
  requiresApproval: z.boolean(),
  status: z.enum(['proposed', 'approved', 'executing', 'succeeded', 'failed', 'rejected']),
});
export type ProposedAction = z.infer<typeof ActionSchema>;
export type ChatMessage = { id: string; user: string; text: string; ts: string };
export type PollInput = { title: string; choices: string[]; duration: number };
export interface TwitchAdapter {
  connect(): Promise<void>;
  getChannel(): Promise<{ broadcasterId: string; displayName: string }>;
  updateMetadata(input: { title?: string; categoryId?: string; tags?: string[] }): Promise<void>;
  subscribeChat(fn: (m: ChatMessage) => void): Promise<() => void>;
  disconnect(): Promise<void>;
}
export interface ObsAdapter {
  connect(): Promise<void>;
  listScenes(): Promise<string[]>;
  getStreamStatus(): Promise<{ active: boolean }>;
  ensureOverlaySource(url: string): Promise<void>;
  switchScene(scene: string): Promise<void>;
  startStream(): Promise<void>;
  stopStream(): Promise<void>;
  disconnect(): Promise<void>;
}
export type OverlayMessage = {
  type: 'SHOW_BANNER' | 'HIDE_BANNER' | 'SHOW_COUNTDOWN' | 'SHOW_POLL' | 'SHOW_RESULT';
  text?: string;
  mode?: DirectorMode;
  choices?: string[];
  seconds?: number;
};
export type ActionResult = { actionId: string; ok: boolean; detail: string; ts: string };
export type ReadinessReport = {
  ready: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
};
export type SessionRecap = {
  sessionId: string;
  title: string;
  durationSec: number;
  interventions: number;
  failed: number;
  highlights: { ts: string; text: string }[];
  summary: string;
  improvements: string[];
  events: DirectorEvent[];
  actions: ProposedAction[];
};
export type CueSettings = {
  demo: boolean;
  overlays: boolean;
  sceneSwitching: boolean;
  cooldownSec: number;
  mode: DirectorMode;
};
export type CueSnapshot = {
  sessionId: string;
  status: 'draft' | 'ready' | 'live' | 'ended';
  plan: StreamPlan | null;
  settings: CueSettings;
  twitch: { connected: boolean; displayName: string };
  obs: { connected: boolean; streaming: boolean; scene: string; scenes: string[] };
  overlay: { staged: boolean; text: string; url: string };
  paused: boolean;
  events: DirectorEvent[];
  actions: ProposedAction[];
  results: ActionResult[];
  startedAt: string | null;
  error: string | null;
};
export type SetupStatus = {
  twitchConfigured: boolean;
  plannerConfigured: boolean;
  plannerModel: string;
  obsCredentialsSaved: boolean;
  rememberConnections: boolean;
  obsHost: string;
  obsPort: number;
};
export interface CueAPI {
  getSetupStatus(): Promise<SetupStatus>;
  setRememberConnections(enabled: boolean): Promise<SetupStatus>;
  getSnapshot(): Promise<CueSnapshot>;
  createPlan(brief: string, mode: DirectorMode): Promise<StreamPlan>;
  savePlan(plan: StreamPlan): Promise<void>;
  connectTwitch(): Promise<{ displayName: string }>;
  connectObs(config: { host: string; port: number; password: string }): Promise<void>;
  checkReadiness(): Promise<ReadinessReport>;
  applyMetadata(planId: string): Promise<void>;
  stageOverlay(): Promise<void>;
  requestConfirmation(operation: 'start' | 'stop'): Promise<string>;
  startStream(token: string): Promise<void>;
  endStream(token: string): Promise<void>;
  pauseDirector(paused: boolean): Promise<void>;
  getRecap(sessionId: string): Promise<SessionRecap>;
  updateSettings(settings: Partial<CueSettings>): Promise<void>;
  sendMessage(text: string): Promise<void>;
  injectDemo(): Promise<void>;
  subscribeEvents(listener: (event: DirectorEvent) => void): () => void;
  onSnapshot(listener: (snapshot: CueSnapshot) => void): () => void;
  deleteHistory(): Promise<void>;
  disconnect(service: 'twitch' | 'obs'): Promise<void>;
}

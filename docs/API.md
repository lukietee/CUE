# Desktop API

`packages/shared/index.ts` defines the Zod contracts and `CueAPI`. `apps/desktop/electron/preload.ts` exposes those specific methods as `window.cue`; there is no public generic invoke method.

| Operation                                    | Behavior                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `createPlan(brief, mode)` / `savePlan(plan)` | Validate and persist an editable plan. Optional model planner runs only in real mode; local fallback is always available. |
| `connectTwitch()` / `connectObs(config)`     | Connect selected real or mock adapters. Renderer receives no OAuth tokens.                                                |
| `checkReadiness()`                           | Inspect plan, channel, OBS, and staged browser source.                                                                    |
| `applyMetadata(planId)` / `stageOverlay()`   | Apply approved metadata; create/reuse and verify the current scene's browser source.                                      |
| `requestConfirmation('start'                 | 'stop')`                                                                                                                  | Native user approval, then a 30-second single-use token. |
| `startStream(token)` / `endStream(token)`    | Consume confirmation, enforce legal lifecycle, execute and wait for observed OBS state.                                   |
| `pauseDirector(paused)`                      | Pause immediately; resuming a live session requires current OBS readiness.                                                |
| `updateSettings(patch)`                      | Mode, overlay permission, cooldown; changing Demo Mode disconnects and swaps adapters outside a live session.             |
| `injectDemo()`                               | Deterministic challenge chat fixture; permitted only in a live demo session.                                              |
| `sendMessage(text)`                          | Manual cues: pause, resume, cinematic/documentary, chill; unsupported prompts receive a bounded help reply.               |
| `getSnapshot()` / `onSnapshot(listener)`     | Defensive copies of persisted domain state; unsubscribe function returned.                                                |
| `subscribeEvents(listener)`                  | Observe normalized events; unsubscribe function returned.                                                                 |
| `getRecap(sessionId)`                        | Derived recap with evidence, actions and improvements.                                                                    |
| `disconnect(service)` / `deleteHistory()`    | Disconnect/erase credentials and local sessions outside active broadcasting.                                              |

A 3-second main-process health loop observes OBS stream status and current scene. Unexpected inactive output pauses directing and surfaces observed state. Reconnect and restage after restart.

The core service injects storage, OBS, Twitch, overlay, and optional model planning dependencies. Unit/integration tests exercise real SQLite and real core policy with mock production adapters and an in-memory overlay transport. Overlay's network test uses actual HTTP/WebSocket clients when loopback permission exists.

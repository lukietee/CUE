# CUE — AI Livestream Producer

> **Build-ready implementation plan** | Hackathon MVP | Desktop-first

## 1. Product vision

**CUE** is a desktop AI producer that helps creators prepare, launch, direct, and recap livestreams through a simple chat interface. It is not just a chatbot or a clip generator: it observes stream state, proposes or executes bounded production actions, and measures the result.

**Tagline:** *Your stream. Right on cue.*

### Primary user journey
1. Open CUE and see a minimal chat box: **“What are we streaming today?”**
2. Describe the stream in natural language (e.g., “IRL stream exploring San Francisco, funny and interactive”).
3. CUE generates an editable title, category, tags, run-of-show, and visual theme.
4. Connect Twitch and local OBS; CUE checks the setup and stages a scene/overlay.
5. User approves **Go Live**. CUE starts OBS streaming and updates Twitch metadata.
6. During the broadcast, CUE monitors chat, engagement proxies, OBS state, and optionally sampled frames/transcripts. It explains its decisions and triggers safe actions: overlay updates, polls, scene cues, suggested talking points, and highlight markers.
7. After the stream, CUE produces a recap, timeline of decisions, highlight suggestions, and lessons for the next session.

### Distinguishing feature
**Closed-loop directing:** Observe → decide → execute → verify → learn. Every intervention has a trigger, rationale, action, outcome, and audit entry. A **Director Mode** (Reality TV, Documentary, Chill) controls tone and production style without changing permissions.

## 2. Scope and priorities

### P0 — Must work for the demo
- Desktop shell with chat-first onboarding and Setup / Live / Recap views.
- Stream brief → structured plan generation with editable title, category, tags, segments, and style.
- Twitch OAuth connection; read channel identity, update stream metadata, ingest chat through supported Twitch interfaces.
- OBS WebSocket connection; list scenes, create or select a CUE overlay browser source, and start/stop streaming only with explicit confirmation.
- A visible live dashboard with chat activity, current OBS scene, recent events, director decisions, and action log.
- At least **one real autonomous action**: e.g., detect a chat-topic spike and update the overlay with a suggested poll/segment, then record verification.
- A deterministic **Demo Mode** with simulated chat/events and no real Twitch or OBS credentials.
- Basic post-stream recap from the action/event log.

### P1 — Strong differentiators if time permits
- Vision sampling from a permitted OBS/program feed or local capture, with privacy-safe frame handling.
- Audio transcription and context-aware cues.
- Real Twitch polls where account eligibility and permissions allow; otherwise a CUE-managed browser-source vote.
- Highlight markers and clip recommendations; automatic clipping only if supported and authorized.
- Multiple Director Modes with distinct overlay styling and prompt templates.
- Basic outcome metrics: messages/min before and after an intervention, poll participation, user acceptance rate.

### P2 — Post-hackathon
- Persistent streamer preferences and learning across sessions.
- Richer visual scene understanding and automatic clip editing.
- Multi-platform support, plugins, collaborative producers, mobile companion, smart-glasses cues.
- Marketplace for production themes.

### Explicit non-goals for MVP
- No unattended stream start or end.
- No automatic public posting or third-party messaging beyond preapproved actions.
- No unsupported promises of Twitch poll, clipping, or API capabilities.
- No face identification, private-information inference, or covert recording.
- No autonomous navigation or real-world instructions that create safety risks.

## 3. Technical architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ Electron desktop app                                         │
│ React + TypeScript + Tailwind                                │
│ Chat | Setup | Live dashboard | Recap | Settings             │
└───────────────┬──────────────────────────────────────────────┘
                │ typed IPC (preload bridge)
┌───────────────▼──────────────────────────────────────────────┐
│ Electron main process                                        │
│ Local orchestration service (Node/TypeScript)                │
│ - Session lifecycle + event bus                              │
│ - Agent planner + deterministic policy engine                │
│ - Twitch adapter (OAuth, metadata, chat/events)              │
│ - OBS adapter (obs-websocket)                                 │
│ - Overlay WebSocket/HTTP server                               │
│ - SQLite storage + event log                                 │
│ - Model provider adapter                                     │
└───────────────┬──────────────────────────────────────────────┘
                │
      ┌─────────┼───────────┬───────────────┐
      ▼         ▼           ▼               ▼
   Twitch    OBS 5.x     LLM API        SQLite
   Helix/    WebSocket   (structured     sessions,
   EventSub              outputs)        events,
                                        actions
      └─────────────► OBS Browser Source ◄── Local overlay server
```

**Recommended stack:** Electron, React, TypeScript, Vite, Tailwind, Zustand (UI state), Zod (schemas), `obs-websocket-js`, `better-sqlite3` (or another compatible SQLite package), and an LLM provider SDK. Prefer a single TypeScript codebase over adding Python for the MVP. If a Python vision worker is truly needed, isolate it behind an optional local service.

**Architecture rule:** The renderer never receives OAuth refresh tokens, API keys, or unrestricted filesystem/network access. All privileged actions run in the main process behind validated IPC handlers.

## 4. Suggested monorepo structure

```text
cue/
├── apps/
│   └── desktop/
│       ├── electron/
│       │   ├── main.ts
│       │   ├── preload.ts
│       │   └── ipc/
│       └── src/
│           ├── app/
│           ├── components/
│           ├── features/
│           │   ├── chat/
│           │   ├── setup/
│           │   ├── live/
│           │   ├── recap/
│           │   └── settings/
│           └── styles/
├── packages/
│   ├── shared/        # Zod schemas, types, constants
│   ├── core/          # Session service, event bus, policies
│   ├── agent/         # Planner, prompts, tool registry
│   ├── twitch/        # Twitch adapter and mock
│   ├── obs/           # OBS adapter and mock
│   ├── overlay/       # Local overlay server + browser page
│   └── storage/       # SQLite migrations and repositories
├── fixtures/          # Demo-mode events and scenarios
├── docs/
│   ├── API.md
│   ├── SECURITY.md
│   └── DEMO.md
├── .env.example
├── package.json
└── pnpm-workspace.yaml
```

## 5. Screens and UX

### A. Welcome / chat-first setup
- Centered CUE logo, connection status chips, one chat input.
- Placeholder: **“What are we streaming today?”**
- Example prompts: “Just Chatting Q&A”, “IRL city walk”, “Gaming challenge”.
- CUE asks only essential follow-up questions; otherwise generates a draft.
- Show generation progress and recoverable errors.

### B. Stream plan review
- Editable title, category, tags, description/notes, Director Mode.
- Segment timeline (intro, main activity, audience interaction, wrap-up).
- Connection checks: Twitch authorized, OBS connected, scene exists, overlay reachable.
- Buttons: **Apply to Twitch**, **Stage in OBS**, **Go Live**.
- Each action shows a preview and requires appropriate authorization. **Go Live** always requires a final confirmation dialog.

### C. Live production dashboard
- Left: chat with CUE and manual commands (“Make it more cinematic”, “Pause automatic overlays”).
- Center: preview/status, active scene, live timer, activity indicators.
- Right: Director feed with `Observation → Decision → Action → Result` cards.
- Bottom: action timeline, current overlay, safe-action toggles, emergency **Pause Director**.
- Display clear status: OBS connected vs actually streaming; Twitch connected vs channel live.

### D. Post-stream recap
- Session duration, interventions, accepted/rejected actions, notable chat spikes.
- Highlight suggestions with timestamps and evidence.
- Narrative summary and 2–3 concrete improvements for next time.
- Export recap as Markdown or JSON.

### E. Settings
- Twitch connect/disconnect, OBS host/port/password, model provider credentials.
- Permission toggles: overlays, polls, scene switching, metadata updates, frame sampling, audio transcription.
- Director Mode, auto-action frequency, cooldowns, and Demo Mode.
- Delete local session history and credentials.

## 6. Domain model and data contracts

Use Zod schemas as the source of truth and infer TypeScript types from them.

```ts
type DirectorMode = 'reality_tv' | 'documentary' | 'chill';
type SessionStatus = 'draft' | 'ready' | 'live' | 'ended';
type ActionStatus = 'proposed' | 'approved' | 'executing' | 'succeeded' | 'failed' | 'rejected';

type StreamPlan = {
  id: string;
  brief: string;
  title: string;
  categoryId?: string;
  categoryName?: string;
  tags: string[];
  mode: DirectorMode;
  segments: Array<{ id: string; name: string; goal: string; durationMin?: number }>;
};

type DirectorEvent = {
  id: string;
  sessionId: string;
  ts: string; // ISO timestamp
  source: 'twitch' | 'obs' | 'vision' | 'audio' | 'system' | 'demo';
  kind: string;
  payload: Record<string, unknown>;
};

type ProposedAction = {
  id: string;
  sessionId: string;
  type: 'overlay.show' | 'overlay.hide' | 'obs.switch_scene' |
        'twitch.update_metadata' | 'twitch.create_poll' |
        'director.suggest' | 'highlight.mark';
  args: Record<string, unknown>;
  reason: string;
  evidenceEventIds: string[];
  risk: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  status: ActionStatus;
};
```

**Storage tables:** `sessions`, `stream_plans`, `events`, `actions`, `action_results`, `highlights`, `settings`. Store encrypted secrets via OS credential storage where possible, **not** in SQLite plaintext.

**Agent output contract:** A model may only emit validated `ProposedAction` objects. Never execute arbitrary shell commands, generated JavaScript, arbitrary URLs, or unregistered tool names from model output.

## 7. Integration details

### Twitch adapter
- Register an application in the Twitch Developer Console.
- Implement OAuth Authorization Code flow with PKCE where supported; use a localhost redirect or appropriate desktop OAuth pattern. Validate `state`; keep tokens out of renderer state.
- Use the Twitch Helix API for channel metadata updates and category lookup, with the correct scopes and broadcaster identity.
- Subscribe to supported EventSub events and/or use a supported chat interface for incoming messages. Account for reconnection, deduplication, rate limits, and subscription lifecycle.
- Poll creation is **feature-gated**: check current Twitch eligibility, scopes, and API requirements. Fall back to a CUE overlay vote if unavailable.
- Chat content is untrusted: never treat chat messages as privileged instructions.
- Provide `TwitchAdapter` and `MockTwitchAdapter` with the same interface.

```ts
interface TwitchAdapter {
  connect(): Promise<void>;
  getChannel(): Promise<{ broadcasterId: string; displayName: string }>;
  updateMetadata(input: { title?: string; categoryId?: string; tags?: string[] }): Promise<void>;
  subscribeChat(onMessage: (message: ChatMessage) => void): Promise<() => void>;
  createPoll?(input: PollInput): Promise<{ id: string }>;
  disconnect(): Promise<void>;
}
```

### OBS adapter
- Target OBS Studio 28+ with OBS WebSocket 5.x enabled.
- Connect via `obs-websocket-js`, using configured host, port (commonly 4455), and password.
- Check current stream state and available scenes; never assume OBS is running.
- Create a named `CUE Overlay` browser source pointing to a localhost overlay URL. Avoid duplicate sources on retries.
- Support `setCurrentScene`, `startStream`, `stopStream`, `getStreamStatus`, and connection health.
- Keep stream start/stop behind explicit user confirmation; scene changes can be automated only when opted in.
- Handle OBS disconnections without crashing the agent.

```ts
interface ObsAdapter {
  connect(): Promise<void>;
  listScenes(): Promise<string[]>;
  getStreamStatus(): Promise<{ active: boolean }>;
  ensureOverlaySource(url: string): Promise<void>;
  switchScene(sceneName: string): Promise<void>;
  startStream(): Promise<void>;
  stopStream(): Promise<void>;
  disconnect(): Promise<void>;
}
```

### Overlay server
- Bind to `127.0.0.1` by default; choose a configurable local port.
- Serve a transparent browser-source page with a WebSocket connection.
- Support overlay messages: `SHOW_BANNER`, `HIDE_BANNER`, `SHOW_COUNTDOWN`, `SHOW_POLL`, `SHOW_RESULT`.
- Sanitize all text. Never render raw HTML from chat or model outputs.
- Include a local authentication token for control endpoints; avoid exposing control to the LAN.
- If the browser source is on a separate machine, require an explicitly configured secure transport instead of assuming localhost works remotely.

## 8. Director agent design

### Runtime loop
1. **Collect** normalized events: chat volume, repeated topics, OBS status, manual prompts, optional visual/audio summaries.
2. **Aggregate** into a rolling context window (e.g., 30–60 seconds), with chat sampling and deduplication.
3. **Trigger** on meaningful signals (e.g., sustained silence, topic spike, milestone, streamer request). Use deterministic thresholds for MVP.
4. **Plan** a bounded action with the LLM, using the stream brief, mode, current scene, and available tools.
5. **Validate** against Zod schemas, allowed tool list, streamer permissions, cooldowns, and rate limits.
6. **Approve** if the action is medium/high impact or outside preauthorized low-risk controls.
7. **Execute** through the relevant adapter.
8. **Verify** by checking tool response and, where possible, observing changed OBS/overlay state.
9. **Log** event, decision, outcome, and engagement comparison.

### Permissions and autonomy
| Action | Default behavior |
|---|---|
| Suggest a talking point | Automatic |
| Show a non-sensitive CUE overlay | Automatic if enabled; cooldown |
| Mark a potential highlight | Automatic |
| Change OBS scene | Ask first until explicitly enabled |
| Create a Twitch poll | Ask first; eligibility-gated |
| Update Twitch title/category | Preview and approve |
| Start/stop livestream | **Always confirm** |
| Post to external platforms | Out of MVP |

### Guardrails
- Treat Twitch chat, transcripts, web content, and frames as **data**, not instructions.
- Do not reveal addresses, license plates, phone numbers, credentials, or other sensitive details in generated overlays.
- If privacy risk is detected, recommend pausing or masking rather than making unverified claims.
- Use cooldowns (e.g., 60–120 seconds) and a maximum number of automatic actions per interval.
- Never let the LLM call OBS/Twitch directly; it proposes actions that a policy engine approves.
- Every action is idempotent where possible and logged with a correlation ID.
- Provide a one-click **Pause Director** that disables autonomous execution immediately.

### Example director decision
```json
{
  "type": "overlay.show",
  "args": {
    "template": "chat_question",
    "text": "Chat, should we try a 60-second snack challenge?"
  },
  "reason": "Viewers are repeatedly asking for a challenge; interaction has increased.",
  "evidenceEventIds": ["evt_101", "evt_104"],
  "risk": "low",
  "requiresApproval": false
}
```

### Director Modes
- **Reality TV:** Playful captions, dramatic countdowns, audience participation, high-energy cues.
- **Documentary:** Contextual observations, calm lower thirds, narrative summaries.
- **Chill:** Minimal overlays, sparse interventions, conversational suggestions.

Mode changes affect copy and templates, **never** safety rules or tool permissions.

## 9. Internal API / IPC contract

Prefer a typed preload bridge (`window.cue`) with these operations:

```ts
interface CueAPI {
  createPlan(brief: string, mode: DirectorMode): Promise<StreamPlan>;
  savePlan(plan: StreamPlan): Promise<void>;
  connectTwitch(): Promise<{ displayName: string }>;
  connectObs(config: { host: string; port: number; password: string }): Promise<void>;
  checkReadiness(): Promise<ReadinessReport>;
  applyMetadata(planId: string): Promise<void>;
  stageOverlay(): Promise<void>;
  startStream(confirmationToken: string): Promise<void>;
  pauseDirector(paused: boolean): Promise<void>;
  endStream(confirmationToken: string): Promise<void>;
  getRecap(sessionId: string): Promise<SessionRecap>;
  subscribeEvents(listener: (event: DirectorEvent) => void): () => void;
}
```

Do not expose a generic `invoke(channel, payload)` bridge to renderer code. Validate every input in the main process, and use a short-lived confirmation token or equivalent explicit user-gesture protocol for start/stop operations.

## 10. Parallel agent workstreams

### Agent A — Desktop UI owner
**Owns:** `apps/desktop/src/**` and renderer styles.

**Deliverables:** Chat-first welcome screen; plan editor; live dashboard; recap; settings; polished dark UI; loading/empty/error states; demo-mode navigation.

**Contract:** Use types from `packages/shared`; call only the typed `window.cue` bridge. No direct Twitch/OBS calls.

**Acceptance:** Can complete the full user journey with mock adapters; no broken buttons; responsive desktop layout.

### Agent B — Twitch integration owner
**Owns:** `packages/twitch/**`.

**Deliverables:** OAuth, channel metadata update, chat/event ingestion, reconnection, mock adapter, scope/error documentation.

**Contract:** Implement `TwitchAdapter`; publish normalized events to core; never store tokens in renderer.

**Acceptance:** Can connect a test account, update title after approval, receive a real chat event, and gracefully reconnect.

### Agent C — OBS + overlay owner
**Owns:** `packages/obs/**`, `packages/overlay/**`.

**Deliverables:** OBS connection, scene discovery, idempotent browser-source staging, overlay templates, stream status, mock adapter.

**Contract:** Implement `ObsAdapter`; expose typed overlay messages; no stream start without core approval.

**Acceptance:** A banner triggered from CUE visibly appears in an OBS scene; disconnect/reconnect works.

### Agent D — Director agent owner
**Owns:** `packages/agent/**`.

**Deliverables:** Prompt templates, planner, structured-output parsing, action proposals, event-trigger logic, three modes, deterministic fallback.

**Contract:** Consume normalized events and emit `ProposedAction` only; no direct network integrations.

**Acceptance:** Given a chat spike fixture, proposes a valid contextual overlay action with rationale and evidence IDs.

### Agent E — Core, storage, and integration owner
**Owns:** `packages/core/**`, `packages/storage/**`, Electron main/preload, shared contracts, CI and end-to-end wiring.

**Deliverables:** IPC, state machine, event bus, policy/approval engine, SQLite migrations, session persistence, secrets handling, integration tests, demo fixtures.

**Contract:** Owns shared schemas and adapter wiring; reviews interfaces with other agents before they implement.

**Acceptance:** End-to-end mock flow and real OBS/Twitch smoke test; failed actions surface visibly and do not corrupt state.

### Collaboration rules
1. **Agent E commits shared Zod schemas and interface stubs first.** Others implement against those contracts.
2. Each agent works on a separate branch/worktree and owns its designated directories.
3. Avoid cross-agent edits to root configs and shared types without coordination.
4. Merge in order: contracts/core → adapters → agent planner → UI → end-to-end fixes.
5. Every agent adds tests, setup instructions, and a short handoff note.
6. Use `MockTwitchAdapter` and `MockObsAdapter` from day one so UI and planner work in parallel.

## 11. Hackathon execution schedule

**If only ~12–16 hours remain, prioritize the demo path.**

| Phase | Timebox | Output |
|---|---:|---|
| 0. Contracts + skeleton | 45 min | Monorepo boots, interfaces frozen, mock data |
| 1. Parallel implementation | 3–4 hr | UI, Twitch, OBS, planner, core built independently |
| 2. First integration | 2 hr | Brief → plan → stage overlay → live decision |
| 3. Reliability and polish | 2 hr | Error handling, permissions, director feed, demo mode |
| 4. Demo rehearsal | 1 hr | Reliable scripted 2–3 minute walkthrough |
| 5. Submission | 1 hr | README, video, screenshots, repository, required hackathon materials |

**Cut order when behind:** vision → transcription → polls → automatic scene switching → persistent learning. **Do not cut:** setup chat, generated plan, real OBS overlay, director decision, audit trail, demo fallback.

## 12. Golden-path demo script (2–3 minutes)

**0:00–0:20 — Hook:** “Streaming software gives creators a control room. CUE gives them an AI production crew.” Show the empty chat-first desktop app.

**0:20–0:50 — Setup:** Type: “I'm doing a chaotic IRL-style stream where chat decides what I do next.” CUE generates a title, category, segments, and Reality TV mode. Edit the title; apply metadata to Twitch.

**0:50–1:15 — Stage:** Show OBS connection, select scene, stage the CUE browser overlay, confirm readiness. Start stream only after explicit confirmation (or use a local OBS recording for a safe demo).

**1:15–2:10 — Agent moment:** Inject real or demo chat messages asking for a challenge. Director feed shows observation, evidence, decision, and action. The overlay appears automatically in OBS. Show action verification and cooldown.

**2:10–2:35 — Control:** Change mode to Documentary, demonstrate a calmer overlay; hit Pause Director to show user control.

**2:35–3:00 — Recap:** End the session and show an automatically generated summary with interventions and highlight timestamps.

**Reliability:** Record a clean local walkthrough ahead of time. Keep a fully working mock mode and seeded fixtures in case Twitch auth, venue Wi-Fi, or OBS fails during live judging.

## 13. Testing and definition of done

### Unit tests
- Plan generation parser rejects malformed outputs.
- Permission engine rejects unauthorized or unsafe actions.
- Cooldowns prevent repeated overlays.
- Duplicate Twitch events do not trigger duplicate actions.
- Session state transitions reject illegal operations.

### Integration tests
- Mock Twitch chat event → normalized event → agent proposal → policy approval → overlay message → logged result.
- OBS connection loss → visible warning → reconnect → overlay restored without duplication.
- OAuth failure/expiration → recoverable UI state; no token leak.
- Stream start/stop requires confirmation even in auto mode.

### Manual smoke test
- Fresh install starts without secrets in Demo Mode.
- Can connect Twitch and OBS separately.
- Can edit and apply a plan.
- Can see a real overlay in OBS.
- Can trigger a contextual production cue from incoming chat.
- Can pause autonomous actions immediately.
- Can generate a recap and restart the app without losing the previous session.

### Success criteria
- **Core:** one complete real integration path, not just a mock UI.
- **Agentic:** at least one observed event causes a validated action and a verified result.
- **Safety:** user explicitly controls stream start/stop and can pause automation.
- **Presentation:** the 3-minute demo is understandable without explaining the code.

## 14. Setup and environment

`.env.example` (never commit real values):

```bash
# Twitch public client identifier; OAuth flow configured for desktop app
TWITCH_CLIENT_ID=
TWITCH_REDIRECT_URI=http://127.0.0.1:3009/callback

# Model credentials should be stored securely, not shipped in app bundles
OPENAI_API_KEY=

# Local development defaults
CUE_OVERLAY_PORT=4318
CUE_DEMO_MODE=true
```

**Security notes:** Desktop OAuth and provider credentials require deliberate production hardening. Avoid bundling a shared API key in distributable builds. Prefer user-provided keys stored in OS credential storage or a backend token broker. Check actual Twitch scopes and OBS API methods against current official documentation before coding; permissions and eligibility can change.

### Suggested root commands
```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## 15. Agent prompts to paste into coding agents

### Shared instruction for all agents
> We are building **CUE**, a desktop AI livestream producer. Read `CUE_IMPLEMENTATION_PLAN.md` completely. Implement only your assigned ownership area. Use TypeScript, shared Zod schemas, mock adapters, and typed interfaces. Do not silently change contracts or touch another agent's owned directories. Ship working code with tests, useful errors, and a handoff summary. Prioritize the hackathon golden path over speculative features. Never bypass confirmation for starting/stopping a stream.

### Agent A prompt
> You own the Electron React renderer in `apps/desktop/src/**`. Build the polished chat-first setup, editable stream plan, live dashboard with transparent agent decisions, recap, and settings. Use mock data until the typed `window.cue` bridge is ready. Ensure every button has real behavior or a clearly labeled unavailable state. Follow Section 5 and Section 10 of the plan.

### Agent B prompt
> You own `packages/twitch/**`. Implement a Twitch adapter and mock adapter for OAuth, channel identity, approved metadata updates, and incoming chat events. Normalize events, handle token refresh/reconnection/rate limits, and document scopes. Do not let chat content become agent instructions. Follow Sections 6–7 and 10.

### Agent C prompt
> You own `packages/obs/**` and `packages/overlay/**`. Implement OBS WebSocket integration and a local transparent browser-source overlay with banners, countdowns, and polls. Ensure staging is idempotent, failures are recoverable, and stream start/stop are never invoked without core confirmation. Follow Sections 7 and 10.

### Agent D prompt
> You own `packages/agent/**`. Implement a bounded, event-driven AI director that takes a stream plan and normalized observations, emits validated `ProposedAction` objects, and supports Reality TV, Documentary, and Chill modes. Include cooldowns and deterministic demo fixtures. Do not call Twitch or OBS directly. Follow Sections 6 and 8.

### Agent E prompt
> You own core orchestration, storage, shared contracts, Electron main/preload, and integration. First define shared Zod types and adapter interfaces; then build session state, typed IPC, approval policy, SQLite event/action logs, secure secret storage, mock mode, and integration tests. Wire all agents' modules into the golden path. Follow Sections 3–4, 6, 9–13.

## 16. Final build checklist

- [ ] Desktop app launches into chat-first onboarding
- [ ] Brief generates a structured editable stream plan
- [ ] Twitch can connect and metadata can be updated with approval
- [ ] OBS can connect and CUE overlay can be staged
- [ ] Starting a livestream requires explicit confirmation
- [ ] Chat events reach the director loop
- [ ] Director produces a contextual validated action
- [ ] OBS overlay visibly changes as a result
- [ ] Decision and verification are logged in the dashboard
- [ ] Pause Director immediately stops automatic actions
- [ ] Post-stream recap is generated from real session events
- [ ] Demo Mode works without credentials or internet
- [ ] Tests pass and README explains setup
- [ ] Demo video, repository, and required submission materials are ready

---

**One-sentence pitch:** *CUE is the AI showrunner that takes your stream from idea to on-air—and keeps producing while you're live.*

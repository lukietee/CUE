# CUE

**Your stream. Right on cue.** A local desktop livestream producer built with Electron, React, TypeScript and SQLite.

Describe your show, edit a plan, connect your studio, approve going live, and let a bounded director turn repeated chat topics into verified OBS overlay cues. The decision feed records observations, evidence, execution and verification. Finish with a persisted recap and Markdown/JSON exports.

## Run

Requires Node.js **24+** and npm. Package installation needs internet access, including Electron's platform download.

```sh
npm install
npm run dev
```

CUE starts in **Demo Mode**, without Twitch credentials, OBS, model credentials, or network requests. Its transparent overlay server binds locally to `127.0.0.1:4318`. Even Demo Mode needs permission to open that local port.

```sh
npm test
npm run check
npm run build
npm start
```

`npm run dev:web` previews the renderer only; production operations require Electron's preload bridge. It does not provide a standalone web app.

## Two-minute demo

1. Describe an interactive city walk and choose a director mode.
2. Edit the plan. **Connect Twitch** and **Connect OBS** use simulated adapters in Demo Mode.
3. **Apply to Twitch** previews the metadata. **Stage in OBS** stages the simulated source; the real local overlay feed is running.
4. Run readiness, choose **Go live**, and approve both the app preview and native confirmation. Demo Mode never starts a public stream.
5. Open Live Production and **Inject chat spike**. Three repeated challenge messages trigger a contextual overlay. Inspect the evidence IDs, reasoning and verification result.
6. **Pause Director**, inject more chat, and see that no additional cue executes. There is a default 60-second cooldown, adjustable between 10 and 600 seconds.
7. Confirm **End stream** and export your recap.

## Real production

Copy `.env.example` to `.env` and set `TWITCH_CLIENT_ID` to your own **public** Twitch application's client ID. No client secret is distributed. Register a public client with device authorization support in the Twitch Developer Console. Switch off Demo Mode in Settings and reconnect both services.

- Twitch opens the official device authorization page in your browser. Enter the public code displayed in CUE. It requests `user:read:chat` and `channel:manage:broadcast`, validates the user identity, and subscribes to your channel's EventSub chat. See [Twitch setup](packages/twitch/README.md).
- Enable **Tools → WebSocket Server Settings** in OBS Studio 28+; enter the local host, port (usually 4455), and password in Settings. Staging creates/reuses **CUE Overlay** in the current scene. Configure your OBS stream destination yourself. See [OBS setup](packages/obs/README.md).
- **Go live starts OBS broadcasting to its configured destination.** It always requires a native confirmation. OBS connectivity and actual broadcasting are displayed separately. Quitting CUE does not stop OBS.
- Set `CUE_OVERLAY_PORT` to another available local port if necessary. The browser-source URL contains a local read token; restage after restarting CUE. See [overlay protocol](packages/overlay/README.md).
- Optionally set `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env` for structured plan generation in real mode. Only the creative brief and director mode are sent to the provider. Demo Mode uses the local planner. Provider failures fall back to an editable local plan. The director trigger loop remains deterministic and bounded.

Metadata is applied only after the app's explicit preview/approval. Category names resolve to exact Twitch matches; use a valid numeric category ID or edit the category if no match exists. Real Twitch polls, automated scene switching, frame sampling, transcription, and public posting are deferred; no UI pretends to execute them.

## State and security

Electron's main process owns adapters, credentials, policy, SQLite and the overlay server. The sandboxed renderer gets a fixed typed bridge; it cannot send generic IPC or access Node. OAuth credentials use OS-backed Electron `safeStorage` encryption; if unavailable, tokens stay memory-only. OBS passwords remain in main-process memory after connection. Model keys stay in environment configuration. Secrets are not placed in SQLite.

Session plans, events, decisions and results persist in `cue.sqlite` under Electron's application user-data directory. Restarting an active session restores its audit history with automation paused. Reconnect OBS, restage the overlay, check actual broadcasting and explicitly resume. Delete history in Settings to remove local sessions and disconnect stored Twitch credentials. Environment configuration is managed separately.

See [security boundaries](docs/SECURITY.md), [typed API](docs/API.md), [demo rehearsal](docs/DEMO.md), and [implementation status](docs/IMPLEMENTATION.md).

## Development and commits

All project commits include `Co-authored-by: lukietee <lucasnotlukie@gmail.com>`.

The standard `.git` repository now contains the implementation history on `main`; use normal Git commands. `.cue-git` remains an ignored backup of the initial development history.

Enable the versioned commit hook in a new checkout to automatically add the required coauthor trailer:

```sh
git config core.hooksPath .githooks
```

The hook is already enabled in this workspace. GitHub CLI authentication is configured locally for `lukietee`.

There is no configured remote. Add your intended remote before pushing or creating PRs. A reviewable PR description is prepared in [docs/PULL_REQUEST.md](docs/PULL_REQUEST.md). GitHub prohibits approving a PR with its author's account.

## Validation limits

Initial implementation checks ran in a sandbox that blocked outbound DNS, loopback listeners, and Electron installation. Existing cached packages were used for local compilation and tests; local ignored declaration fallbacks were needed for unavailable Electron and `ws` types. The network overlay integration explicitly skips only on an `EPERM` bind failure. Run `npm install`, `npm test`, and `npm run build` on an unrestricted desktop for validation with the official dependencies. A credentialed Twitch/OBS smoke test and Electron visual rehearsal are still required; neither a public broadcast nor real-account authorization was performed here.

# Studio interface

CUE uses a Twitch-inspired dark production workspace: a near-black canvas, charcoal navigation and cards, bright purple controls, and pale violet links and active states. Shared CSS tokens define surfaces, text, borders, hover states, and error treatments. The separate accent text color keeps small links readable against dark panels, while white text remains on filled purple buttons. Native controls and the launch background also use the dark theme. The native macOS window supplies the rounded outer corners; there is no second inset web-page frame or separate dark title-bar strip. Real traffic-light controls sit above the sidebar, the header is draggable, and controls remain clickable. The sidebar stays in place while content scrolls. The main composition is an overview row above a stream brief, directing styles, and studio checklist. Every number comes from the active session; no engagement graphs or outcome metrics are invented.

Typography and spacing provide the hierarchy. Numbered sections and directing styles replace decorative sparkle imagery and repeated icon badges. Icons remain on navigation and controls where they clarify an action. The featured purple session card anchors the dark workspace. Compact button corners and subtle panel borders keep controls distinct from the background. Sidebar navigation is kept minimal, with settings at the bottom.

The same colors, controls, field treatments and spacing apply to the plan editor, live desk, recap, settings, confirmations, errors, and Twitch authorization. Permission controls and explicit stream start/stop confirmations remain functional. Connection labels distinguish OBS connectivity from actual broadcasting, and the director has a standby state outside active production.

## Desktop verification

```sh
npm run test:desktop
```

This builds the application and runs its real Electron window through an isolated Demo Mode session. The test uses a temporary user-data directory and ephemeral overlay port, exercises the preload bridge and SQLite, checks confirmation before start, triggers a cue, pauses the director, ends the session, and saves a real Markdown recap. Native confirmations are auto-accepted only in that disposable instance after asserting Demo Mode. No real channel credentials are used.

The check captures Studio, Plan, Live, Recap, Settings, and compact Settings and narrow Studio/Settings screenshots. Set `CUE_SCREENSHOT_DIR` to keep them in a specific folder. It requires a desktop display and an installed Electron executable; it is separate from the headless core test suite.

## Development reload check

```sh
npm run test:desktop:dev
```

This starts a separate local Vite instance and sends a real full-reload message. A transformed renderer revision proves the new document actually loaded, and the typed brief must survive the reload. Navigation is allowed only to the canonical app entry URL, including its normalized trailing slash; arbitrary paths and origins remain blocked. Both desktop checks compare native window and content heights on macOS to detect a reintroduced title-bar strip.

## OBS password entry and retry

Switching out of Demo Mode clears the demo password and focuses the OBS password field. A failed OBS connection retains the entered password and selects it for replacement. Show/Hide controls make entry verifiable, and a successful connection clears the form password. Connection guidance points to OBS's WebSocket server settings.

```sh
npm run build
node --import tsx scripts/smoke-obs-settings.ts
```

This uses a disposable Electron profile and a local authenticated OBS protocol fixture. It checks keyboard entry after a mode change, a rejected password, retry without clicking the field again, Show/Hide, successful connection, and re-entry after disconnect. It does not connect to the user's OBS or start a broadcast.

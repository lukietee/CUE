# Renderer handoff

Implemented the React renderer against `packages/shared/index.ts` and the typed `window.cue` bridge. The renderer has no direct Twitch/OBS/network integration and no fake local backend.

- Chat-first welcome, prompt examples, and three director modes.
- Editable title/category/category ID/tags/brief and segment names/goals/durations.
- Twitch/OBS connection controls, overlay staging, readiness results, metadata preview approval, and explicit start/stop confirmation dialogs.
- Live status, timer, chat, commands, verified director decisions, permissions, pause, demo chat spike, and event timeline.
- Recap metrics, evidence-based highlights, improvements, Markdown/JSON export, and next-session entry.
- Settings for OBS endpoint/password, connections, demo mode, director permissions/mode/cooldown, and deletion confirmation.
- Responsive dark studio styling, reduced motion support, loading/error/empty states, and accessible input labels.

Validation: `tsc --noEmit` passes for this branch. `vite build` succeeds (33 modules). Desktop integration and full end-to-end checks are owned by the core integration branch. Browser-only entry explicitly asks the user to launch the desktop bridge.

Manual journey: launch desktop → describe stream → edit/save → connect Twitch and OBS (mock in demo) → stage overlay → readiness check → confirm start → inject chat spike → inspect action result → pause director → confirm end → export recap.

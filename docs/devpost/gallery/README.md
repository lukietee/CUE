# Devpost media gallery

Seven 1800 × 1200 (3:2) PNGs, each under 400 KB. Upload them in order; `01-cover.png` is the project thumbnail. The app screenshots are unedited captures from `npm run test:desktop` in Demo Mode with the current dark theme, framed with headings for the gallery.

| File | Caption |
| --- | --- |
| `01-cover.png` | CUE is a desktop livestream producer. It plans your show, listens to Twitch chat, and cues your OBS overlay, and you stay in control. |
| `02-brief.png` | Studio: describe your stream in a sentence and choose a directing style (Reality TV, Documentary, or Chill). CUE turns it into an editable stream plan. |
| `03-plan.png` | Stream plan: edit the title, category, tags, and timed running order, connect Twitch and OBS, and stage a transparent CUE overlay in your current OBS scene. |
| `04-live.png` | Live production: when three chat messages mention "challenge" within a minute, the director shows a "Chat decides" cue on the overlay. The feed shows the observation, the decision, and the overlay server's verification. |
| `05-control.png` | Director permissions: going live, ending the stream, and updating Twitch metadata always require your confirmation. Toggle automatic overlays, switch director mode, and set the minimum time between cues. |
| `06-recap.png` | Session recap: CUE stores every event, decision, and production action locally in SQLite. Review highlight suggestions and next-stream tips, then export Markdown or JSON. |
| `07-architecture.png` | How it works: a sandboxed React renderer talks to Electron's main process over a typed IPC bridge. The main process owns Twitch EventSub, OBS WebSocket 5.x, a local overlay server, SQLite, and the bounded director loop (observe → decide → execute → verify). |

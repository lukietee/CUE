# Implement CUE desktop livestream producer MVP

CUE turns a stream brief into an editable run of show and directs a broadcast through explicitly confirmed OBS controls. This change adds the desktop studio, Twitch OAuth/EventSub, OBS 5.x and browser overlay integration, a bounded chat-topic director, persisted evidence/audit logs, and session recaps. A credential-free Demo Mode exercises the complete journey.

Validation includes planner parsing, privacy/permission policy, cooldown/dedup, OAuth cancellation and refresh, OBS transport authentication and staging, confirmation expiry/replay/invalidation, delayed stream transitions, recovery, SQLite transactions, and a full mock session. Renderer and Electron bundles compile locally with cached dependencies. The actual loopback overlay integration skips on this sandbox's EPERM bind restriction. Electron launch and credentialed Twitch/OBS smoke testing remain to be run on an unrestricted desktop. See README for exact environment limits.

Co-authored-by: lukietee <lucasnotlukie@gmail.com>

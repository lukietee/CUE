# Rehearsal

Start with `npm install && npm run dev` on a desktop that permits local servers. Leave Demo Mode enabled.

1. Enter “I'm doing a chaotic IRL-style stream where chat decides what I do next.” Choose Reality TV and generate.
2. Edit the title. Connect demo Twitch and OBS. Approve Apply to Twitch. Stage overlay and run readiness.
3. Go live and approve the native demo confirmation. No public broadcast occurs.
4. Inject chat spike. Read the director's evidence and rationale, then the result. The preview displays the current local overlay text; it is labeled a production status view, not a captured video feed.
5. Open the browser-source URL in a local browser if you want to verify the actual transparent overlay. With a real OBS connection, inspect it in the OBS program scene.
6. Pause Director and inject again. No further automatic action occurs. The cooldown also prevents repeat cues. Change to Documentary and resume; wait until cooldown expires before another cue.
7. End the stream with confirmation. Export Markdown and JSON.
8. Restart CUE and inspect the preserved recap. Starting a new plan creates a fresh session while keeping the previous session in storage.

## Real smoke test still required

Use your own public Twitch client and account, a local OBS instance and configured destination. Turn off Demo Mode and reconnect. Validate device authorization, metadata, real chat delivery, staged source, and a real cue in OBS. Starting and ending a real broadcast requires explicit user approval inside CUE. This coding session did not perform that broadcast.

Check disconnect/reconnect, occupied overlay port, revoked Twitch authorization, OBS authentication errors, and restart during an active session. Do not claim the demo video or submission assets are recorded until you create them.

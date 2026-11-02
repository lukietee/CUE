# Local overlay feed

```ts
const overlay = new OverlayServer({ port: 4318 }); // port 0 selects an ephemeral port
await overlay.start();
await obs.ensureOverlaySource(overlay.url);
await overlay.publish({ type: 'SHOW_BANNER', text: 'Chat chooses the next challenge', mode: 'reality_tv' });
console.log(overlay.state, overlay.verification);
await overlay.close();
```

`publish()` validates bounded plain-text messages and returns `{revision, clients}`. `state` returns a defensive copy. `verification` reports `{revision, acknowledgedRevision, clients}`; a revision is acknowledged only when a connected browser client reports it rendered the packet. Publishing to an empty feed verifies server state, **not** visual delivery. A browser acknowledgement confirms its renderer handled the update, not that OBS is live or that a viewer saw it.

The HTTP and WebSocket feeds bind only to `127.0.0.1`. A random per-server token authenticates reads, the Host header must match, and browser WebSocket origins must match. No HTTP endpoint can mutate overlay state. Keep the tokenized URL local; it grants read/acknowledgement access. Both initial state and reconnect state replay to OBS. Browser reconnection retries every 1.5 seconds. User content enters DOM through `textContent`; it is never interpreted as HTML.

Templates: `SHOW_BANNER`, `HIDE_BANNER`, `SHOW_COUNTDOWN` with `seconds`, `SHOW_POLL` with text and choices, and `SHOW_RESULT`. The poll is an on-screen prompt only; it does not collect votes or create a Twitch poll. Core must implement and authorize vote collection separately.

# OBS integration

`RealObsAdapter({host?, port?, password?, onConnectionChange?})` implements the shared adapter. `MockObsAdapter()` uses the same async interface and exposes `overlayUrl` for tests. Both also provide `getCurrentScene()`.

Enable OBS Studio's **Tools → WebSocket Server Settings**, use port 4455 and its password. CUE supports loopback connections only. Core must perform explicit start/stop confirmation before invoking adapter methods. An accepted StartStream request does not mean OBS has finished connecting to Twitch: poll `getStreamStatus()` to verify active output. Connection loss invokes the callback with false; call `connect()` again to reconnect and stage the overlay again. Errors propagate as recoverable failures.

Staging creates a browser input named **CUE Overlay** in the current program scene, enables it, and places it on top. Retrying updates the existing browser input and reuses its scene item; changing scenes adds a reference to that same input. A conflicting non-browser input name produces an error. The configured URL is read back for verification. The source is 1920×1080; adjust the source transform in OBS for other canvas dimensions.

Protocol methods were checked against the [official OBS WebSocket 5.x protocol](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md). Tests validate idempotency using a fake transport; a real OBS instance is required for visual smoke testing.

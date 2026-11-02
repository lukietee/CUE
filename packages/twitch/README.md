# Twitch adapter

Run in Electron main only. `RealTwitchAdapter` implements the shared adapter; `MockTwitchAdapter` implements identical methods and offers `inject(ChatMessage)` for deterministic fixtures.

```ts
const twitch = new RealTwitchAdapter({
  clientId: process.env.TWITCH_CLIENT_ID ?? '',
  openExternal: url => shell.openExternal(url),
  tokenStore: encryptedMainProcessStore,
  onAuthorization: ({ userCode }) => emitStatus(`Enter ${userCode} in Twitch`),
  onStatus: emitStatus,
  onError: error => emitConnectionError(error.message),
});
await twitch.connect();
const unsubscribe = await twitch.subscribeChat(message => ingestChat(message));
```

`TokenStore` has async `load`, `save`, and `clear` methods. Its values are `TwitchTokens` (`access_token`, `refresh_token`, `expires_in`, `scope`). Use encrypted OS-backed storage; omitting the store keeps credentials in memory. Never expose it over IPC. Disconnect clears stored credentials. A token must match the configured client ID and include the requested scopes.

## Register and connect

1. Register an application at the Twitch Developer Console and set client type **Public**. Supply its client ID through `TWITCH_CLIENT_ID`. This implementation does not need or accept an application secret.
2. Connect from CUE. The adapter opens Twitch's device authorization page in the system browser; the user reviews and grants scopes there. The device code is private and never sent to the renderer; the display code is safe to show.
3. Authenticate as the channel broadcaster. CUE subscribes to that user's own channel. Scopes: `user:read:chat` for EventSub chat; `channel:manage:broadcast` for title, category ID, and tags.
4. For metadata, preview/approval happens in core before calling `updateMetadata`. Twitch's response acknowledges the write; there is no publish-to-chat method.

Twitch's current documented public-client device flow is used rather than inventing unsupported PKCE behavior. It has no local callback/state exchange. OAuth polling honors pending/slowdown and expiry; cancelling the adapter invalidates an in-progress flow. Tokens validate at connection and hourly. HTTP 401 triggers a serialized refresh; rotated refresh tokens are persisted. 429 responses receive bounded retries. Invalid grants require reconnection.

EventSub uses its supported WebSocket endpoint. Welcome triggers subscription registration; ordinary loss retries with bounded exponential delay and fresh registration. Keepalive timeout reconnects. Server-directed migration preserves the old connection until the new welcome and preserves subscriptions. Chat IDs are deduplicated across reconnects in a bounded cache. Missed events during an ordinary disconnect cannot be replayed. Revocation disconnects, clears credentials, and reports a recoverable error. WebSocket ping/pong is handled by `ws`.

## Limits and validation

Real Twitch polls, clipping, channel-live discovery, category name lookup, and outbound chat are deliberately unavailable. Use the CUE overlay for audience prompts. `categoryId` must be an existing numeric Twitch game/category ID; a category display name alone is not applied. Chat is returned strictly as data, never interpreted as privileged instructions. Tests simulate network responses; no test account or live Twitch session was available for a manual smoke test.

Official references verified during implementation:

- [Device code grant](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow)
- [Token refresh and public clients](https://dev.twitch.tv/docs/authentication/refresh-tokens/)
- [EventSub WebSocket lifecycle](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/)
- [Chat message subscription](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage)
- [Modify channel information](https://dev.twitch.tv/docs/api/reference/#modify-channel-information)

Run `npm test` from the project root after installing dependencies. `packages/twitch/twitch.test.ts` covers mock lifecycle, metadata identity, EventSub subscription/deduplication, device authorization, and invalid token identity.

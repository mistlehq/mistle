# @mistle/published-target-auth

Shared published-target auth primitives for control-plane minting and gateway verification.

Current scope:

- derive and parse canonical published port hosts
- mint and verify published target access tokens
- mint and verify published target share tokens

This package only handles shared host/token semantics for published ports. It does not handle:

- HTTP request token extraction
- gateway session-cookie minting or verification
- websocket/session lifecycle
- replay protection persistence (`jti` single-use tracking)

## Public API

Exported from [`src/index.ts`](./src/index.ts):

- `derivePublishedTargetHost(input)`
- `parsePublishedTargetHost(input)`
- `mintPublishedTargetAccessToken(input)`
- `verifyPublishedTargetAccessToken(input)`
- `mintPublishedTargetShareToken(input)`
- `verifyPublishedTargetShareToken(input)`

## Example Usage

### Control-plane minting

```ts
import {
  derivePublishedTargetHost,
  mintPublishedTargetAccessToken,
  mintPublishedTargetShareToken,
} from "@mistle/published-target-auth";
```

### Gateway-side verification

```ts
import {
  parsePublishedTargetHost,
  verifyPublishedTargetAccessToken,
  verifyPublishedTargetShareToken,
} from "@mistle/published-target-auth";
```

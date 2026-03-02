# @mistle/gateway-connection-auth

Shared connection token auth primitives for caller/client gateway connections.

Current scope:

- mint connection tokens for caller/client connection bootstrap
- verify connection tokens and normalize failure categories

This package only handles token signing and verification semantics. It does not handle:

- HTTP request token extraction
- websocket/session lifecycle
- replay protection persistence (`jti` single-use tracking)

## Public API

Exported from [`src/index.ts`](./src/index.ts):

- `mintConnectionToken(input)`
- `verifyConnectionToken(input)`
- `ConnectionTokenError`
- `ConnectionTokenErrorCode`
- `ConnectionTokenConfig`
- `VerifiedConnectionToken`

## Example Usage

### Control-plane minting

```ts
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
```

### Gateway-side verification

```ts
import { ConnectionTokenError, verifyConnectionToken } from "@mistle/gateway-connection-auth";
```

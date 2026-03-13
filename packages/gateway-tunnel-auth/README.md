# @mistle/gateway-tunnel-auth

Shared bootstrap tunnel token auth primitives for Mistle gateway tunnel bootstrap.

Current scope:

- mint bootstrap tokens for sandbox tunnel bootstrap
- verify bootstrap tokens and normalize failure categories
- mint tunnel exchange tokens for sandbox reconnect bootstrap exchange
- verify tunnel exchange tokens and normalize failure categories

This package only handles token signing and verification semantics. It does not handle:

- HTTP request token extraction
- websocket/session lifecycle
- replay protection persistence (`jti` single-use tracking)

## Public API

Exported from [`src/index.ts`](./src/index.ts):

- `mintBootstrapToken(input)`
- `verifyBootstrapToken(input)`
- `mintTunnelExchangeToken(input)`
- `verifyTunnelExchangeToken(input)`
- `BootstrapTokenError`
- `BootstrapTokenErrorCode`
- `BootstrapTokenConfig`
- `VerifiedBootstrapToken`
- `TunnelExchangeTokenError`
- `TunnelExchangeTokenErrorCode`
- `TunnelExchangeTokenConfig`
- `VerifiedTunnelExchangeToken`

## Example Usage

### Worker-side minting

```ts
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
```

### Gateway-side verification

```ts
import { BootstrapTokenError, verifyBootstrapToken } from "@mistle/gateway-tunnel-auth";
```

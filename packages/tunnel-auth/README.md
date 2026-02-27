# @mistle/tunnel-auth

Shared bootstrap tunnel token auth primitives for Mistle data-plane components.

Current scope:

- mint bootstrap tokens for sandbox tunnel bootstrap
- verify bootstrap tokens and normalize failure categories

This package only handles token signing and verification semantics. It does not handle:

- HTTP request token extraction
- websocket/session lifecycle
- replay protection persistence (`jti` single-use tracking)

## Public API

Exported from [`src/index.ts`](./src/index.ts):

- `mintBootstrapToken(input)`
- `verifyBootstrapToken(input)`
- `BootstrapTokenError`
- `BootstrapTokenErrorCode`
- `BootstrapTokenConfig`
- `VerifiedBootstrapToken`

### `BootstrapTokenConfig`

```ts
type BootstrapTokenConfig = {
  bootstrapTokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
};
```

### `mintBootstrapToken`

```ts
mintBootstrapToken(input: {
  config: BootstrapTokenConfig;
  jti: string;
  ttlSeconds: number;
}): Promise<string>;
```

Mints a signed HS256 JWT with `iss`, `aud`, `iat`, `exp`, and `jti`.

### `verifyBootstrapToken`

```ts
verifyBootstrapToken(input: {
  config: BootstrapTokenConfig;
  token: string;
}): Promise<{
  jti: string;
}>;
```

Verifies signature and claims (`iss`, `aud`, `exp`) and returns normalized token data.

### `BootstrapTokenError` and `BootstrapTokenErrorCode`

All package errors are thrown as `BootstrapTokenError` with a stable `code`:

- `TOKEN_REQUIRED`
- `JTI_REQUIRED`
- `INVALID_TTL_SECONDS`
- `TOKEN_EXPIRED`
- `TOKEN_INVALID_ISSUER`
- `TOKEN_INVALID_AUDIENCE`
- `TOKEN_INVALID_CLAIMS`
- `TOKEN_VERIFICATION_FAILED`
- `TOKEN_SIGNING_FAILED`

## Example Usage

### Worker-side minting

```ts
import { mintBootstrapToken } from "@mistle/tunnel-auth";

const token = await mintBootstrapToken({
  config: {
    bootstrapTokenSecret: runtimeConfig.tunnel.bootstrapTokenSecret,
    tokenIssuer: runtimeConfig.tunnel.tokenIssuer,
    tokenAudience: runtimeConfig.tunnel.tokenAudience,
  },
  jti: "jti_123",
  ttlSeconds: runtimeConfig.app.tunnel.bootstrapTokenTtlSeconds,
});

await sandboxHandle.writeStdin({
  payload: new TextEncoder().encode(`${token}\n`),
});
await sandboxHandle.closeStdin();
```

### Gateway-side verification

```ts
import { BootstrapTokenError, verifyBootstrapToken } from "@mistle/tunnel-auth";

try {
  const verified = await verifyBootstrapToken({
    config: {
      bootstrapTokenSecret: runtimeConfig.tunnel.bootstrapTokenSecret,
      tokenIssuer: runtimeConfig.tunnel.tokenIssuer,
      tokenAudience: runtimeConfig.tunnel.tokenAudience,
    },
    token: bootstrapTokenFromRequest,
  });

  // Use verified.jti for single-use replay protection in DB.
} catch (error) {
  if (error instanceof BootstrapTokenError) {
    // Map to 401/403 style auth response as needed.
  }
  throw error;
}
```

## Test Coverage

[`src/bootstrap-token.test.ts`](./src/bootstrap-token.test.ts) covers:

- mint + verify round trip
- invalid `jti`
- invalid `ttlSeconds`
- invalid audience
- expired token
- missing `jti` claim

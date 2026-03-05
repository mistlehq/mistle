# @mistle/sandbox-session-protocol

Shared TypeScript types for sandbox session websocket control messages.

## Source of truth

- Go schema source: `apps/sandbox-runtime/internal/sessionprotocol/types.go`
- JSON schema generator: `apps/sandbox-runtime/cmd/sandbox-session-protocol-schema`

## Commands

- Generate types:
  - `pnpm --filter @mistle/sandbox-session-protocol protocol:generate`
- Check drift:
  - `pnpm --filter @mistle/sandbox-session-protocol protocol:check`

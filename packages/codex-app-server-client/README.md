# @mistle/codex-app-server-client

Shared client package for talking to the Codex app server over the sandbox agent channel.

## What This Package Owns

This package gives apps one reusable way to open a sandbox agent channel, complete the session handshake, speak JSON-RPC over that channel, and call Codex app server methods. Today the main consumer is `apps/dashboard`, but the package is structured so other apps or workers can use the same client without depending on dashboard code.

## Internal Split

The package is split into three layers under `src/`:

- `session/`
- `json-rpc/`
- `codex/`

### `session/`

Files in `session/` handle connection lifecycle and message transport: browser or Node websocket setup, the sandbox agent `connect` handshake, connection state, and parsing incoming messages into higher-level event categories.

This layer is **not Codex app server specific**, but it is **specific to our sandbox session transport**. It exists because JSON-RPC is not the first protocol boundary. The client must first open the websocket and complete the sandbox handshake before the Codex app server can speak over the channel.

### `json-rpc/`

Files in `json-rpc/` handle JSON-RPC request/response behavior: issuing requests with IDs, tracking pending requests, handling responses, and routing notifications or server-originated requests.

This layer is **Codex agnostic**. It does not know about threads, turns, models, or Codex-specific method names.

### `codex/`

Files in `codex/` are the Codex app server bindings: method wrappers such as `thread/start`, `turn/start`, and `thread/read`, plus response validation and Codex-specific DTO shaping.

This is the only layer that is truly **Codex app server specific**.

## Why The Package Is Not Split Further Today

There is a reasonable future split where:

- `session/` moves into a sandbox session client package
- `json-rpc/` moves into a generic JSON-RPC package
- `codex/` remains in `@mistle/codex-app-server-client`

We are not doing that today because:

- there is currently no second consumer for the lower layers
- splitting them into separate packages now would add package overhead without reducing meaningful coupling yet

The current package boundary is pragmatic: consumers import one package today, while the internal layering keeps the future extraction boundary explicit if another non-Codex consumer appears.

## Public API

The package exposes:

- the main public exports from `src/index.ts`
- browser runtime entrypoint from `src/browser.ts`
- Node runtime entrypoint from `src/node.ts`

Thin compatibility wrappers also exist at the package root source level so existing imports do not break while the internal module layout stays clean.

## Usage Direction

Use this package for:

- shared Codex app server transport/protocol logic
- browser and Node consumers that need to talk to the Codex app server

Do not use this package for:

- dashboard-specific React state
- transcript UI state
- control-plane conversation routing or orchestration

Those concerns belong in higher layers outside this package.

# @mistle/codex-app-server-client

Shared client package for speaking the Codex app server protocol on top of the sandbox agent channel.

## What This Package Owns

This package gives apps one reusable way to speak Codex app server JSON-RPC and typed Codex operations once a sandbox agent connection exists. Today the main consumer is `apps/dashboard`, but the package is structured so other apps or workers can use the same Codex protocol client without depending on dashboard code.

## Internal Split

The package is split into two layers under `src/`:

- `json-rpc/`
- `codex/`

The sandbox agent transport/session layer now lives in `@mistle/sandbox-agent-client`.

### `json-rpc/`

Files in `json-rpc/` handle JSON-RPC request/response behavior: issuing requests with IDs, tracking pending requests, handling responses, and routing notifications or server-originated requests.

This layer is **Codex agnostic**. It does not know about threads, turns, models, or Codex-specific method names.

### `codex/`

Files in `codex/` are the Codex app server bindings: method wrappers such as `thread/start`, `turn/start`, and `thread/read`, plus response validation and Codex-specific DTO shaping.

This is the only layer that is truly **Codex app server specific**.

## Why The Package Is Not Split Further Today

There is still a reasonable future split where:

- `json-rpc/` moves into a generic JSON-RPC package
- `codex/` remains in `@mistle/codex-app-server-client`

We are not doing that today because:

- there is currently no second consumer for the JSON-RPC layer
- splitting that layer further today would add package overhead without reducing meaningful coupling yet

The current package boundary is pragmatic: sandbox transport/session concerns are separated out, while Codex-specific protocol behavior remains together in one package.

## Public API

The package exposes:

- the main public exports from `src/index.ts`
- thin compatibility wrappers for the older Codex session exports so existing imports do not break during the transition to `@mistle/sandbox-agent-client`

## Usage Direction

Use this package for:

- shared Codex app server JSON-RPC and operation wrappers
- consumers that need to talk to the Codex app server after the sandbox agent connection has been established

Do not use this package for:

- dashboard-specific React state
- transcript UI state
- control-plane conversation routing or orchestration

Those concerns belong in higher layers outside this package.

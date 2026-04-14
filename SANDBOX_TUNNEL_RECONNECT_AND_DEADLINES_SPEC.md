# Sandbox Tunnel Reconnect And Deadlines Spec

## Status

Working spec.

This document is grounded in the current code on `main` as of April 13, 2026.

## Goal

Make sandbox connectivity and timeout behavior correct across gateway restarts
and transient network failures so that:

- a live `sandboxd` process autonomously re-establishes its bootstrap tunnel
  without an external `resume` call
- idle timeout and disconnect-grace behavior survive gateway restarts because
  timer ownership is durable rather than process-local
- system behavior is verified by a real end-to-end system test with no internal
  repair or reconcile shortcuts

## Non-Goals

Out of scope for this change:

- adding fallback runtime behavior beyond the explicit reconnect design here
- keeping the current gateway-local idle controller as a backup path
- introducing a new public API for manual reattachment
- making `sandboxd` a general-purpose multi-gateway or multi-session broker
- solving unrelated `init(existing)` workspace idempotency in the same stack

## Current Code Grounding

### 1. `sandboxd` startup input already carries a rolling tunnel credential

`StartupInput` includes both `bootstrap_token` and
`tunnel_exchange_token` in:

- `packages/sandboxd/src/protocol/startup.rs`

The data-plane worker already mints both values when it builds startup input
for sandbox initialization and resume in:

- `apps/data-plane-worker/openworkflow/start-sandbox-instance/initialize-sandbox-runtime.ts`

### 2. The gateway already exposes a tunnel token-exchange route

The data-plane gateway exposes:

- `POST /tunnel/sandbox/:instanceId/token-exchange`

in:

- `apps/data-plane-gateway/src/tunnel/register-sandbox-tunnel-token-exchange-route.ts`

That route:

- verifies the current `tunnelExchangeToken`
- rejects sandboxes that are not in `starting` or `running`
- records one-time redemption of the current exchange token
- returns a fresh pair:
  - `bootstrapToken`
  - `tunnelExchangeToken`

The returned exchange token is therefore intended to roll forward after every
successful redemption.

### 3. `sandboxd` does not currently use `tunnel_exchange_token`

The current tunnel session start path only uses:

- `startup_input.bootstrap_token`
- `startup_input.tunnel_gateway_ws_url`

in:

- `packages/sandboxd/src/tunnel/session.rs`

`TunnelSession::start(...)` clones the bootstrap token once and
`run_tunnel_session(...)` connects directly to the websocket URL derived from
that bootstrap token. There is no current runtime path in `sandboxd` that
redeems `tunnel_exchange_token` after disconnect.

### 4. `sandboxd` does not autonomously reconnect today

Once `run_tunnel_session(...)` exits, the current session thread exits. A new
tunnel session is only created when an external control-path calls
`SandboxdState::resume(...)` in:

- `packages/sandboxd/src/sandboxd_state.rs`

This means transient gateway restarts currently require an external recovery
path even when the daemon itself is healthy.

### 5. Gateway timer ownership is process-local

Idle timeout, disconnect grace, and retry timing currently live in:

- `apps/data-plane-gateway/src/idle/sandbox-idle-controller.ts`
- `apps/data-plane-gateway/src/idle/sandbox-idle-controller-registry.ts`

These files explicitly describe the controller as a local runtime object. A
gateway restart therefore loses the active timer chain for:

- idle timeout
- disconnect grace
- request retry

### 6. The actual stop and reconcile actions are already durable worker paths

The worker already has fenced implementations for:

- idle stop in
  `apps/data-plane-worker/openworkflow/stop-sandbox-instance/stop-sandbox-instance.ts`
- disconnect reconciliation in
  `apps/data-plane-worker/openworkflow/reconcile-sandbox-instance/reconcile-sandbox-instance.ts`

The problem is not missing worker policy. The problem is that the timer that
decides when to invoke those policies currently lives in gateway memory.

## Decision Summary

We will make two architectural changes together:

1. `sandboxd` will own tunnel liveness for a live sandbox runtime.
2. Gateway timer ownership will move to durable data plus data-plane API owned
   workflow scheduling.

The resulting split is:

- `sandboxd`
  - owns tunnel connection state
  - redeems the rolling tunnel exchange token
  - reconnects indefinitely while the daemon is alive
- gateway
  - owns websocket admission and live session handling
  - writes durable runtime facts directly
  - requests deadline state changes through data-plane internal API
  - does not own idle or disconnect timers
- data-plane API + data-plane DB + OpenWorkflow
  - own idle deadlines
  - own disconnect deadlines
  - wake durable worker execution at the deadline
- data-plane worker
  - re-reads current state when a deadline fires
  - applies fenced stop/reconcile behavior

## Stacked Branch Plan

Implementation will land as eleven stacked branches in this exact order.

Each branch is intentionally narrow. A later branch may depend on earlier
symbols, but no branch is allowed to partially implement a later branch's
behavior.

### Branch 1: `sandboxd` tunnel supervisor refactor

Files owned by this branch:

- `packages/sandboxd/src/tunnel/session.rs`
- `packages/sandboxd/src/sandboxd_state.rs`

This branch does exactly these code changes:

- change `TunnelSession::close(self)` to return `()`
- remove `SandboxdStateError::CloseTunnelSession`
- split tunnel runtime into:
  - one supervisor loop
  - one connected-session loop
- make the connected-session loop return only:
  - `ShutdownRequested`
  - `RestartRequired`
- keep the initial connection path using `startup_input.bootstrap_token`
- make the branch-1 supervisor behavior:
  - `ShutdownRequested` => stop permanently
  - `RestartRequired` => exit the supervisor without reconnecting

This preserves current runtime behavior while introducing the supervisor split.
Branch 2 changes only the handling of `RestartRequired`.

This branch does not:

- perform token exchange
- reconnect after disconnect
- touch DB schema
- touch gateway code
- add system tests

Tests in this branch:

- update Rust tunnel-session tests to cover the new supervisor/close behavior

### Branch 2: `sandboxd` reconnect and rolling token exchange

Files owned by this branch:

- `packages/sandboxd/src/tunnel/session.rs`

This branch does exactly these code changes:

- derive the token-exchange HTTP endpoint from `tunnel_gateway_ws_url`
- implement token exchange using the existing `hyper` / `hyper-util` /
  `hyper-rustls` stack
- add the bounded reconnect loop to the supervisor
- persist the rolling `current_tunnel_exchange_token` inside the supervisor
- roll the exchange token forward immediately after successful exchange
- reconnect on every `RestartRequired`
- stop permanently only on:
  - explicit `TunnelSession::close(self)`
  - token-exchange `401`
  - token-exchange `404`
  - token-exchange `409`

This branch does not:

- touch `packages/sandboxd/Cargo.toml`
- touch DB schema
- touch worker workflows
- touch gateway code
- add system tests

Tests in this branch:

- Rust tests for initial connect
- Rust tests for reconnect after websocket loss
- Rust tests for token rollover across a second reconnect
- Rust tests for terminal token-exchange responses

### Branch 3: deadline schema and DB accessors

Files owned by this branch:

- `packages/db/src/data-plane/schema/sandbox-instance-deadlines.ts`
- `packages/db/src/data-plane/schema/*` barrel exports

This branch does exactly these code changes:

- add the `sandbox_instance_deadlines` table
- export:
  - `SandboxInstanceDeadlineKinds`
  - `SandboxInstanceDeadlineKind`
  - `sandboxInstanceDeadlines`

This branch does not:

- add workflow specs
- execute deadlines
- add consumer-specific DB accessors
- touch gateway runtime behavior
- touch `sandboxd`
- add system tests

Tests in this branch:

- schema-level and DB helper integration tests only

### Branch 4: deadline workflow registry and worker execution

Files owned by this branch:

- `packages/workflow-registry/src/data-plane.ts`
- `packages/workflow-registry/src/data-plane.test.ts`
- `apps/data-plane-worker/openworkflow/sandbox-instance-deadlines/*`
- `apps/data-plane-worker/openworkflow/start-sandbox-instance/mark-sandbox-instance-failed.ts`
- `apps/data-plane-worker/openworkflow/start-sandbox-instance/workflow.ts`
- `apps/data-plane-worker/openworkflow/resume-sandbox-instance/resume-sandbox-instance.ts`
- `apps/data-plane-worker/openworkflow/stop-sandbox-instance/*`
- `apps/data-plane-worker/openworkflow/reconcile-sandbox-instance/*`
- `apps/data-plane-worker/openworkflow/workflows.test.ts`

This branch does exactly these code changes:

- add:
  - `HandleSandboxInstanceDeadlineWorkflowName`
  - `HandleSandboxInstanceDeadlineWorkflowVersion`
  - `HandleSandboxInstanceDeadlineWorkflowInput`
  - `HandleSandboxInstanceDeadlineWorkflowOutput`
  - `HandleSandboxInstanceDeadlineWorkflowSpec`
- implement the deadline workflow
- add worker-local deadline DB accessors under
  `apps/data-plane-worker/openworkflow/sandbox-instance-deadlines/`
- re-read deadline row, runtime-state, and sandbox row before acting
- execute:
  - idle stop for `kind = idle`
  - disconnect reconcile for `kind = disconnect`
- make every worker helper in scope that commits terminal durable state also
  clear both deadline kinds:
  - `markSandboxInstanceStopped`
  - `markSandboxInstanceFailed`
- keep that rule broad rather than deadline-specific, so any worker flow that
  reaches those helpers in this branch clears deadlines, including:
  - stop
  - reconcile
  - start failure
  - resume failure through the shared failed-state helper

This branch does not:

- schedule deadline workflows from the gateway
- remove gateway-local timer ownership
- add system tests
- touch `sandboxd`

Tests in this branch:

- worker integration tests for generation fencing
- worker integration tests for payload fencing on `ownerLeaseId` and `dueAt`
- worker integration tests for cleared-row no-op behavior
- worker integration tests for deadline clearing after stop/reconcile

### Branch 5: data-plane internal deadline API and client

Files owned by this branch:

- `packages/data-plane-internal-client/src/index.ts`
- `packages/data-plane-internal-client/src/generated/schema.ts`
- `apps/data-plane-api/src/internal/sandbox/routes.ts`
- `apps/data-plane-api/openapi/data-plane.internal.v1.json`
- `apps/data-plane-api/src/internal/sandbox/sandbox-instances/put-sandbox-instance-deadline/index.ts`
- `apps/data-plane-api/src/internal/sandbox/sandbox-instances/put-sandbox-instance-deadline/route.ts`
- `apps/data-plane-api/src/internal/sandbox/sandbox-instances/put-sandbox-instance-deadline/handler.ts`
- `apps/data-plane-api/src/internal/sandbox/sandbox-instances/put-sandbox-instance-deadline/schema.ts`
- `apps/data-plane-api/src/internal/sandbox/sandbox-instances/delete-sandbox-instance-deadline/index.ts`
- `apps/data-plane-api/src/internal/sandbox/sandbox-instances/delete-sandbox-instance-deadline/route.ts`
- `apps/data-plane-api/src/internal/sandbox/sandbox-instances/delete-sandbox-instance-deadline/handler.ts`
- `apps/data-plane-api/src/internal/sandbox/sandbox-instances/delete-sandbox-instance-deadline/schema.ts`
- `apps/data-plane-api/src/internal/sandbox-instances/services/put-sandbox-instance-deadline.ts`
- `apps/data-plane-api/src/internal/sandbox-instances/services/delete-sandbox-instance-deadline.ts`
- data-plane-api integration tests for those files

This branch does exactly these code changes:

- add internal deadline resource routes:
  - `PUT /internal/sandbox/instances/:id/deadlines/:kind`
  - `DELETE /internal/sandbox/instances/:id/deadlines/:kind`
- add data-plane-api-local deadline DB accessors under
  `apps/data-plane-api/src/internal/sandbox-instances/services/`
- define `:kind` as the path enum:
  - `idle`
  - `disconnect`
- make the `PUT` handler:
  - create or replace the deadline row
  - accept request body fields:
    - `ownerLeaseId: string`
    - `dueAt: string` as the canonical UTC ISO 8601 string produced by
      `Date.prototype.toISOString()`
  - validate `dueAt` by requiring:
    - `new Date(input.dueAt).toISOString() === input.dueAt`
  - reject non-canonical `dueAt` with `400`
  - increment `generation` when:
    - `ownerLeaseId` changes
    - `dueAt` changes
    - the existing row is currently cleared
  - compute the workflow payload from:
    - `sandboxInstanceId`
    - `kind`
    - `ownerLeaseId`
    - `dueAt`
    - `generation`
  - call `openWorkflow.runWorkflow(...)` before persisting the row
  - schedule `HandleSandboxInstanceDeadlineWorkflowSpec` using the existing
    data-plane-api `openWorkflow`
  - persist the deadline row only after workflow scheduling succeeds
  - persist the same canonical `dueAt` string into the row that was used in
    the workflow payload
  - return:
    - `status: "accepted"`
    - `sandboxInstanceId`
    - `kind`
    - `generation`
    - `workflowRunId`
- make the `DELETE` handler:
  - clear the deadline row immediately by setting `clearedAt`
  - return `200` idempotent success when the row is missing or already cleared
  - return:
    - `status: "ok"`
    - `sandboxInstanceId`
    - `kind`
- add internal client methods:
  - `putSandboxInstanceDeadline(...)`
  - `deleteSandboxInstanceDeadline(...)`

This branch does not:

- touch gateway runtime wiring
- touch `sandboxd`
- add system tests

Tests in this branch:

- data-plane-api integration tests for deadline `PUT` and `DELETE`
- data-plane-api integration tests for generation bump after clear + reactivate
- data-plane-api integration tests for idempotent `DELETE`
- data-plane-api integration tests for the schedule-first / persist-second
  contract
- data-plane-api integration tests for canonical `dueAt` validation
- data-plane-api integration tests for concurrent `PUT` last-write-wins
  semantics
- internal-client tests only if existing client test coverage requires them

### Branch 6: gateway deadline service and live event wiring

Files owned by this branch:

- `packages/config/src/apps/data-plane-gateway/schema.ts`
- `packages/config/src/apps/data-plane-gateway/load-env.ts`
- `packages/config/src/apps/data-plane-gateway/load-toml.ts`
- `packages/config/src/conversion-mappings.ts`
- `packages/config/integration/fixtures/config.toml`
- `packages/config/integration/fixtures/env.ts`
- `packages/config/integration/load-config.integration.test.ts`
- `apps/data-plane-gateway/src/types.ts`
- `apps/data-plane-gateway/src/deadlines/sandbox-instance-deadline-service.ts`
- `apps/data-plane-gateway/src/tunnel/register-sandbox-tunnel-route.ts`
- `apps/data-plane-gateway/src/tunnel/relay-coordinator.ts`
- `apps/data-plane-gateway/src/tunnel/session/tunnel-session-service.ts`
- `apps/data-plane-gateway/src/tunnel/session/tunnel-session-service.test.ts`
- `apps/data-plane-gateway/src/tunnel/sandbox-keepalive-repository.ts`
- `apps/data-plane-gateway/src/runtime/index.ts`
- `apps/data-plane-gateway/src/idle/sandbox-idle-controller.test.ts`
- `apps/data-plane-gateway/integration/test-context.ts`
- `apps/data-plane-gateway/integration/sandbox-instance-deadlines.integration.test.ts`
- `apps/data-plane-api/integration/runtime-status-test-helpers.ts`
- gateway integration tests for those files

This branch does exactly these code changes:

- extend gateway app config with an optional `lifecycle` block:
  - `lifecycle.idleTimeoutMs`
  - `lifecycle.bootstrapDisconnectGraceMs`
- add matching env vars:
  - `MISTLE_APPS_DATA_PLANE_GATEWAY_LIFECYCLE_IDLE_TIMEOUT_MS`
  - `MISTLE_APPS_DATA_PLANE_GATEWAY_LIFECYCLE_BOOTSTRAP_DISCONNECT_GRACE_MS`
- add matching TOML keys:
  - `apps.data_plane_gateway.lifecycle.idle_timeout_ms`
  - `apps.data_plane_gateway.lifecycle.bootstrap_disconnect_grace_ms`
- add config schema objects:
  - `DataPlaneGatewayLifecycleConfigSchema`
  - `PartialDataPlaneGatewayLifecycleConfigSchema`
- add `SandboxInstanceDeadlineService`
- construct it in `runtime/index.ts`
- pass the existing `dataPlaneClient` and clock into
  `SandboxInstanceDeadlineService`
- resolve lifecycle durations in `runtime/index.ts` before constructing
  `SandboxInstanceDeadlineService`:
  - if `config.app.lifecycle` is present, use it
  - if `config.app.lifecycle` is omitted, use the existing internal defaults
    from `apps/data-plane-gateway/src/runtime-state/durations.ts`
- add `TunnelRelayCoordinator.closePeer(...)` so presence-touch deadline
  failures can close the current bootstrap websocket without detaching it first
- make `apps/data-plane-gateway/integration/test-context.ts` start a real
  out-of-process `data-plane-api` dependency for gateway integration tests by
  using the existing `@mistle/test-harness` app launcher rather than an
  in-process import
- update `register-sandbox-tunnel-route.ts` so it constructs
  `TunnelSessionService` and `SandboxKeepaliveRepository` with
  `SandboxInstanceDeadlineService` instead of `SandboxIdleControllerRegistry`
- on bootstrap attach:
  - delete `disconnect` via data-plane internal API
  - put `idle` via data-plane internal API
- on presence touch:
  - put `idle` via data-plane internal API
- on keepalive activity:
  - put `idle` via data-plane internal API
- on bootstrap disconnect:
  - delete `idle` via data-plane internal API
  - put `disconnect` via data-plane internal API
- do not retry deadline API failures and do not keep local fallback timers:
  - bootstrap attach deadline failure => fatal bootstrap-session error and
    websocket close
  - presence-touch deadline failure => fatal bootstrap-session error and
    websocket close
  - keepalive-touch deadline failure => fatal websocket-message error and
    websocket close
  - bootstrap-disconnect deadline failure => reject the disconnect cleanup
    promise so the failure is surfaced and logged

This branch does not:

- refactor `apps/data-plane-gateway/src/app.ts` to async app creation
- touch data-plane-api deadline routes
- delete `sandbox-idle-controller.ts`
- delete `sandbox-idle-controller-registry.ts`
- add system tests
- touch `sandboxd`

After this branch, the old controller files still exist on disk but are fully
unused. All live deadline ownership and scheduling flows through
`SandboxInstanceDeadlineService`.

Tests in this branch:

- gateway integration tests for each event-to-deadline mapping

### Branch 7: gateway cleanup

Files owned by this branch:

- `apps/data-plane-gateway/src/idle/sandbox-idle-controller.ts`
- `apps/data-plane-gateway/src/idle/sandbox-idle-controller-registry.ts`
- `apps/data-plane-gateway/src/idle/sandbox-idle-controller.test.ts`
- `apps/data-plane-gateway/src/idle/sandbox-idle-controller-registry.test.ts`
- `apps/data-plane-gateway/src/runtime/index.ts`
- `apps/data-plane-gateway/src/runtime-state/durations.ts`

This branch does exactly these code changes:

- delete the old gateway-local idle controller files
- remove all remaining runtime wiring for the old controller path
- keep `IDLE_TIMEOUT_MS` and `BOOTSTRAP_DISCONNECT_GRACE_MS` in
  `runtime-state/durations.ts` as the internal gateway defaults used when the
  optional lifecycle config block is omitted
- delete the now-unused retry constant from `runtime-state/durations.ts`:
  - `IDLE_REQUEST_RETRY_MS`

This branch does not:

- add new system tests
- change worker deadline semantics
- change DB schema
- change `sandboxd` reconnect logic

### Branch 8: primary resilience system test and shared helpers

Files owned by this branch:

- `config/config.sample.toml`
- `scripts/config/presets/development/data-plane-gateway.ts`
- `tests/system/create-global-setup.ts`
- `tests/system/system-test-context.ts`
- `packages/test-harness/src/system/full-system-environment.ts`
- `tests/system/sandbox-gateway-restart-resilience.system.test.ts`

This branch does exactly these code changes:

- add the shared system-test helpers defined in this spec:
  - `startSandboxAndWaitReady()`
  - `openPtyAndAssertRoundTrip(instanceId)`
  - `restartContainer(containerId)`
  - `stopContainer(containerId)`
  - `startContainer(containerId)`
  - `waitForSandboxStatus(instanceId, status)`
  - `waitForSandboxConnectable(instanceId, connectable)`
  - `readSandboxRuntimeState(instanceId)`
- extend `SystemTestContext` and `SystemTestFixture` with:
  - `dataPlaneGatewayIdleTimeoutMs`
  - `dataPlaneGatewayBootstrapDisconnectGraceMs`
- in `tests/system/create-global-setup.ts`, pass these exact gateway lifecycle
  env vars through `dataPlaneGatewayEnvironment`:
  - `MISTLE_APPS_DATA_PLANE_GATEWAY_LIFECYCLE_IDLE_TIMEOUT_MS = 20000`
  - `MISTLE_APPS_DATA_PLANE_GATEWAY_LIFECYCLE_BOOTSTRAP_DISCONNECT_GRACE_MS = 8000`
- in `packages/test-harness/src/system/full-system-environment.ts`, continue
  forwarding `dataPlaneGatewayEnvironment` to the `data-plane-gateway`
  container and expose those two configured values through `SystemTestContext`
- in `packages/test-harness/src/system/full-system-environment.ts`, set
  `MISTLE_APPS_DATA_PLANE_GATEWAY_DATA_PLANE_API_BASE_URL` to
  `DATA_PLANE_API_CONTAINER_BASE_URL` when starting the gateway container so
  branch-6 deadline API calls reach the in-network `data-plane-api`
- add an optional commented lifecycle example to `config/config.sample.toml`
- do not add lifecycle values to
  `scripts/config/presets/development/data-plane-gateway.ts`
- in `tests/system/create-global-setup.ts`, provide the shortened lifecycle
  values only through the gateway container environment used by the system-test
  stack
- add the primary gateway-restart resilience system test

This branch does not:

- add the token-rollover system test
- add the disconnect-deadline-cleared system test
- add the idle-deadline-survives-restart system test
- change product code

### Branch 9: token rollover system test

Files owned by this branch:

- `tests/system/sandbox-gateway-restart-token-rollover.system.test.ts`

This branch does exactly these code changes:

- add the token-rollover system test

This branch does not:

- change product code
- change shared helper behavior except for test-only helper extension required
  by the token-rollover test
- change worker deadline semantics
- change DB schema
- change `sandboxd` reconnect logic

### Branch 10: reconnect-clears-disconnect-deadline system test

Files owned by this branch:

- `tests/system/sandbox-disconnect-deadline-cleared-on-reattach.system.test.ts`

This branch does exactly these code changes:

- add the reconnect-clears-disconnect-deadline system test

This branch does not:

- change product code
- change shared helper behavior except for test-only helper extension required
  by the reconnect-clears-disconnect-deadline test
- change worker deadline semantics
- change DB schema
- change `sandboxd` reconnect logic

### Branch 11: idle-deadline-survives-restart system test

Files owned by this branch:

- `tests/system/sandbox-idle-deadline-survives-gateway-restart.system.test.ts`

This branch does exactly these code changes:

- add the idle-deadline-survives-gateway-restart system test

This branch does not:

- change product code
- change shared helper behavior except for test-only helper extension required
  by the idle-deadline-survives-restart test
- change worker deadline semantics
- change DB schema
- change `sandboxd` reconnect logic

## Detailed Design

### 1. `sandboxd` autonomous reconnect

#### 1.1 Ownership model

`SandboxdState` does not gain any new reconnect fields.

The rolling reconnect state is owned entirely by the `TunnelSession`
supervisor thread created by `TunnelSession::start(...)`. The supervisor thread
holds:

- `sandbox_instance_id: String`
- `tunnel_gateway_ws_url: String`
- `token_exchange_url: String`
- `current_tunnel_exchange_token: String`

The bootstrap token is not retained after the initial successful connect. It is
used exactly once for the initial websocket session started by `init` or
`resume`.

This means:

- `SandboxdState` continues to own runtime adapters, keepalive manager,
  readiness manager, and one `TunnelSession`
- `TunnelSession` owns shutdown signaling and one supervisor thread
- the supervisor thread owns the rolling reconnect credential

#### 1.2 `TunnelSession` API contract

`TunnelSession::start(...) -> Result<TunnelSession, TunnelSessionError>` keeps
the same top-level return shape, but its semantics are fixed as follows:

- it spawns one supervisor thread
- the supervisor thread attempts the initial websocket connection using
  `startup_input.bootstrap_token`
- `TunnelSession::start(...)` returns `Ok(...)` only after that initial
  websocket session is fully established and the connected session loop has run
  the existing tunnel-connected side effects
- if the initial websocket connection cannot be established, `start(...)`
  returns `Err(...)`

`TunnelSession::close(self)` changes signature to return `()`.

`SandboxdState::resume(...)` and `SandboxdState::close(...)` stop treating
tunnel close as an error path.

#### 1.3 Reconnect loop ownership

`sandboxd` will maintain exactly one live tunnel supervisor loop for the
initialized runtime.

That loop is responsible for:

1. acquiring fresh tunnel credentials
2. establishing one bootstrap websocket session
3. running the session until it ends
4. deciding whether to stop or retry

This means the unit of ownership changes from:

- "one thread that starts one tunnel session"

to:

- "one thread that supervises a sequence of tunnel sessions"

The current `run_tunnel_session(...)` logic remains the per-connection session
body. It will be wrapped by a reconnect supervisor inside
`packages/sandboxd/src/tunnel/session.rs`.

The reconnect supervisor remains in the existing `TunnelSession` subsystem. We
are not introducing a second parallel tunnel manager type.

#### 1.4 Single-session exit contract

Branch 1 refactors the tunnel runtime into two layers inside
`packages/sandboxd/src/tunnel/session.rs`:

1. a supervisor loop
2. a single connected-session loop

The single connected-session loop returns one of exactly two outcomes:

- `ShutdownRequested`
- `RestartRequired`

`RestartRequired` means the current connected session must be torn down and
recreated by the supervisor. It covers transport loss and all ordinary
connected-session errors, including:

- remote websocket close
- `ConnectionClosed`
- websocket read error
- websocket write error
- bootstrap socket task ending unexpectedly
- invalid tunnel control/data parsing
- telemetry attach/handle failures
- PTY/process/file-upload local invariants
- thread panic
- other `TunnelSessionError` values raised from the connected-session loop

Final supervisor behavior after branch 2 is fixed:

- `ShutdownRequested` => stop permanently
- `RestartRequired` => enter reconnect flow

The supervisor never treats a connected-session failure as terminal. The only
terminal exits for the supervisor are:

- explicit `TunnelSession::close(self)`
- terminal token-exchange responses (`401`, `404`, `409`)

#### 1.5 Reconnect algorithm

When the bootstrap tunnel ends unexpectedly and shutdown has not been
requested:

1. `sandboxd` redeems the current `tunnel_exchange_token` against
   `POST /tunnel/sandbox/:instanceId/token-exchange`
2. if token exchange succeeds, `sandboxd` immediately replaces the stored
   exchange token with the newly returned `tunnelExchangeToken`
3. `sandboxd` attempts websocket connect using the returned `bootstrapToken`
4. if the websocket session later ends again, repeat the flow with the newer
   stored exchange token

This rolling update matters because each exchange token is single-use. Once a
token exchange succeeds, the old token is spent. If the subsequent websocket
connect fails, the next retry must use the newly returned exchange token rather
than retrying the old one.

The initial websocket session created by `TunnelSession::start(...)` does not
perform token exchange first. It uses `startup_input.bootstrap_token`
directly. Token exchange is used only after the first established session has
been lost.

#### 1.6 Exchange request details

`sandboxd` will derive the token-exchange HTTP endpoint from
`tunnel_gateway_ws_url`:

- `ws://.../tunnel/sandbox/:instanceId` -> `http://.../tunnel/sandbox/:instanceId/token-exchange`
- `wss://.../tunnel/sandbox/:instanceId` -> `https://.../tunnel/sandbox/:instanceId/token-exchange`

The request uses:

- `Authorization: Bearer <tunnel_exchange_token>`

The response body is parsed as:

```json
{
  "bootstrapToken": "...",
  "tunnelExchangeToken": "..."
}
```

The current startup protocol already matches these field names, so no startup
payload change is required.

The HTTP client implementation uses the existing Rust HTTP stack already in
`packages/sandboxd/Cargo.toml`:

- `hyper`
- `hyper-util`
- `hyper-rustls`

This branch does not add a new Rust dependency just for token exchange.

Token exchange response handling is fixed:

- `200` => parse both returned tokens, replace `current_tunnel_exchange_token`,
  attempt websocket connect with returned `bootstrapToken`
- `401` => terminal, stop supervisor
- `404` => terminal, stop supervisor
- `409` => terminal, stop supervisor
- `429` => retry with backoff
- `5xx` => retry with backoff
- malformed JSON / missing fields => retry with backoff

#### 1.7 Retry policy

Reconnect retry is indefinite while the daemon is initialized and not shutting
down.

The backoff sequence is fixed:

- attempt 1 after disconnect: immediately
- attempt 2: `250ms`
- attempt 3: `500ms`
- attempt 4: `1000ms`
- attempt 5: `2000ms`
- attempt 6 and later: `5000ms`

There is no jitter in this implementation.

The loop retries on:

- websocket handshake failure
- DNS / TCP / TLS failure
- token-exchange network failure
- token-exchange `5xx`
- token-exchange `429`

The loop stops and leaves the tunnel disconnected without retry when token
exchange returns a terminal application response:

- `401` invalid / expired exchange token
- `404` sandbox instance not found
- `409` sandbox instance no longer eligible for exchange

Those responses mean the control plane no longer considers the current runtime
eligible to reconnect. They are treated as terminal until an external
`resume()` or reinitialization provides a fresh startup input.

Every non-terminal retry path sets both keepalive and runtime readiness to the
disconnected state before sleeping for the next attempt.

After a successful reconnect:

- the backoff attempt counter resets to zero
- the newly established session becomes the current connected session
- the supervisor waits again for either `ShutdownRequested` or
  `RestartRequired`

#### 1.8 Close semantics

`TunnelSession::close(self)` is best-effort and returns `()`.

`close()` does all of the following:

- request shutdown
- wait for the thread to exit
- log any transport error
- return no value

The old tunnel is already disposable when `close()` is called. Transport-level
failure during close is not actionable and does not change caller behavior, so
it does not surface as a return error.

`SandboxdStateError::CloseTunnelSession` is removed from
`packages/sandboxd/src/sandboxd_state.rs`.

#### 1.9 Readiness and keepalive semantics during reconnect

During disconnected periods:

- runtime readiness remains adapter-driven but must continue publishing
  "tunnel disconnected" state via the existing readiness manager behavior
- keepalive publication remains suspended until a tunnel is connected again

The existing `on_tunnel_connected()` / `on_tunnel_disconnected()` hooks in
`KeepaliveManager` and `RuntimeReadinessManager` remain the seam for this.

#### 1.10 Required observability

Branch 1 adds log lines for each of these fixed supervisor events:

- initial tunnel connect failed
- connected session requested restart
- reconnect attempt started
- token exchange failed and will retry
- token exchange failed terminally
- reconnect websocket connect failed and will retry
- reconnect succeeded
- supervisor exiting due to shutdown request

## 2. Durable sandbox instance deadlines

### 2.1 New table

Add a new data-plane table:

- `sandbox_instance_deadlines`

SQL columns:

- `sandbox_instance_id text not null`
- `kind text not null`
- `owner_lease_id text not null`
- `due_at timestamptz not null`
- `generation bigint not null default 1`
- `cleared_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

The only valid `kind` values are:

- `idle`
- `disconnect`

Constraints and indexes:

- composite primary key on `(sandbox_instance_id, kind)`
- foreign key from `sandbox_instance_id` to `sandbox_instances.id`
- btree index on `due_at`

This table belongs in `packages/db/src/data-plane/schema`.

In the Drizzle schema, the TypeScript property names use the repository's
normal camelCase style:

- `sandboxInstanceId` -> `sandbox_instance_id`
- `ownerLeaseId` -> `owner_lease_id`
- `dueAt` -> `due_at`
- `clearedAt` -> `cleared_at`
- `createdAt` -> `created_at`
- `updatedAt` -> `updated_at`

The Drizzle file added in branch 3 is:

- `packages/db/src/data-plane/schema/sandbox-instance-deadlines.ts`

The timestamp columns in the Drizzle schema use the existing data-plane
convention:

- `timestamp(..., { withTimezone: true, mode: "string" })`

That applies to:

- `dueAt`
- `clearedAt`
- `createdAt`
- `updatedAt`

The exported TypeScript declarations are:

- `SandboxInstanceDeadlineKinds = { IDLE: "idle", DISCONNECT: "disconnect" }`
- `type SandboxInstanceDeadlineKind`
- `sandboxInstanceDeadlines`

### 2.2 Meaning of `generation`

`generation` is the monotonic version number for the active deadline row.

It exists because scheduled workflow runs are durable and cannot be unsent once
queued. Old runs may still wake up after a row has been rescheduled, cleared,
or reused for a new owner lease.

Whenever a deadline is materially replaced, its `generation` increments.

Examples:

- idle deadline extended after activity touch
- disconnect deadline created after bootstrap disconnect
- deadline cleared and later reactivated for a new owner
- deadline cleared and later reactivated for the same owner and same due time

When a stale workflow wakes up, it compares its input generation with the
current row generation and no-ops on mismatch.

`generation` increments on every `PUT` that reactivates or materially changes
the row:

- if the row does not exist yet, the new generation is `1`
- if the row exists and `clearedAt` is non-null, the new generation is
  `previousGeneration + 1`
- if the row exists and either `ownerLeaseId` or `dueAt` changes, the new
  generation is `previousGeneration + 1`
- if the row exists, is already active, and both `ownerLeaseId` and `dueAt`
  are unchanged, the generation is unchanged

Clearing a deadline sets only `clearedAt` and `updatedAt`; it does not bump
`generation` on its own.

### 2.3 Row lifecycle

For each `(sandboxInstanceId, kind)`:

- create the row on first activation
- update the existing row on reschedule
- set `clearedAt` when the deadline is no longer active
- reuse the row for later activations by incrementing `generation` and clearing
  `clearedAt`

We keep one mutable row per logical deadline. This change does not add an
append-only deadline history table.

## 3. Deadline workflows

### 3.1 Workflow registry

Add a new workflow to `packages/workflow-registry/src/data-plane.ts`.

The workflow spec is:

- name: `data-plane.sandbox-instance-deadlines.handle`
- version: `1`

Input:

- `sandboxInstanceId`
- `kind`
- `ownerLeaseId`
- `dueAt`
- `generation`

Output:

- `sandboxInstanceId`
- `kind`
- `executed: boolean`

The exact workflow spec symbols added to the registry are:

- `SandboxInstanceDeadlineKind = "idle" | "disconnect"`
- `HandleSandboxInstanceDeadlineWorkflowName = "data-plane.sandbox-instance-deadlines.handle"`
- `HandleSandboxInstanceDeadlineWorkflowVersion = "1"`
- `type HandleSandboxInstanceDeadlineWorkflowInput`
- `type HandleSandboxInstanceDeadlineWorkflowOutput`
- `HandleSandboxInstanceDeadlineWorkflowSpec`

### 3.2 Scheduling model

On every deadline activation or reschedule, the data-plane API `PUT` deadline
service schedules one delayed workflow run by calling
`openWorkflow.runWorkflow(..., { availableAt: dueAt })` with:

- `availableAt = new Date(dueAt)`
- idempotency key derived from:
  - `sandboxInstanceId`
  - `kind`
  - `ownerLeaseId`
  - `dueAt`
  - `generation`

Rescheduling leaves older scheduled runs behind. Correctness comes from
payload fencing plus generation fencing, not from cancellation of
already-scheduled work.

The workflow idempotency key format is fixed to:

`deadline:${sandboxInstanceId}:${kind}:${ownerLeaseId}:${dueAt}:${generation}`

The `PUT` service ordering is fixed:

1. read the current deadline row
2. compute the target `generation`
3. schedule the workflow run using the computed payload and idempotency key
4. persist the deadline row in one DB transaction only after scheduling
   succeeds

If workflow scheduling fails, the service returns an error and does not mutate
the deadline row.

If workflow scheduling succeeds and the subsequent DB write fails, the service
returns an error and does not retry automatically. The scheduled workflow is
still safe because it will later no-op unless the row was persisted with the
same:

- `ownerLeaseId`
- `dueAt`
- `generation`

Concurrent `PUT`s are explicitly last-write-wins at the row level.

This spec does not require compare-and-set rejection for concurrent writers.
Two concurrent `PUT`s for the same `(sandboxInstanceId, kind)` are allowed to
compute the same next `generation`.

Safety relies on payload fencing:

- if two concurrent `PUT`s carry different `ownerLeaseId` or `dueAt` values,
  their scheduled workflows also carry different payloads
- only the workflow whose full payload matches the final persisted row may
  execute
- the other scheduled workflow no-ops on payload mismatch

If two concurrent `PUT`s carry identical `ownerLeaseId`, `dueAt`, and
`generation`, they are treated as the same logical deadline update and share
the same idempotency key.

### 3.3 Worker execution flow

When the deadline workflow wakes up:

1. read the current `sandbox_instance_deadlines` row
2. if the row is missing, cleared, or generation does not match: return
   `executed: false`
3. if the row `ownerLeaseId` does not equal workflow input `ownerLeaseId`,
   return `executed: false`
4. if the row `dueAt` does not equal workflow input `dueAt`,
   return
   `executed: false`
5. read the current runtime-state snapshot
6. read the current durable sandbox row
7. verify owner-lease fencing against the row's `ownerLeaseId`
8. execute the deadline action

Action mapping:

- `idle`
  - call the existing idle stop logic used by
    `stop-sandbox-instance/stop-sandbox-instance.ts`
- `disconnect`
  - call the existing disconnect reconciliation logic used by
    `reconcile-sandbox-instance/reconcile-sandbox-instance.ts`

The deadline workflow calls those worker services directly and does not enqueue
another workflow. Deadline execution is the durable execution path.

The worker files added in branch 4 are:

- `apps/data-plane-worker/openworkflow/sandbox-instance-deadlines/handle-sandbox-instance-deadline.ts`
- `apps/data-plane-worker/openworkflow/sandbox-instance-deadlines/workflow.ts`

The workflow implementation uses the same terminal-state helpers as the
existing stop and reconcile flows.

Those shared helpers are changed in branch 4 so that every successful terminal
transition they commit also clears both `idle` and `disconnect` rows:

- every successful `markSandboxInstanceStopped(...)` clears both deadline kinds
- every successful `markSandboxInstanceFailed(...)` clears both deadline kinds

That rule is intentionally broad and applies no matter which worker flow
reaches the helper, including:

- deadline-triggered stop
- deadline-triggered reconcile
- normal stop
- normal reconcile
- start failure
- resume failure through the existing shared failed-state helper

Deadline clearing for terminal durable state is therefore worker-owned. The
gateway does not clear deadlines in response to `stopped` or `failed`.

## 4. Gateway cutover

### 4.1 Remove timer ownership from the gateway

After the cutover, the gateway must not own:

- idle timeout countdowns
- disconnect-grace countdowns
- request retry countdowns

That means the following files are deleted:

- `apps/data-plane-gateway/src/idle/sandbox-idle-controller.ts`
- `apps/data-plane-gateway/src/idle/sandbox-idle-controller-registry.ts`

The gateway computes due times from the lifecycle durations resolved in
`runtime/index.ts`:

- if `config.app.lifecycle` is present, use its values
- otherwise use the existing internal defaults from
  `apps/data-plane-gateway/src/runtime-state/durations.ts`

and requests deadline persistence through data-plane API instead of holding
local timer handles.

### 4.2 New gateway coordination service

Introduce a stateless gateway service at:

- `apps/data-plane-gateway/src/deadlines/sandbox-instance-deadline-service.ts`

The class name is:

- `SandboxInstanceDeadlineService`

Responsibilities:

- call the internal deadline `PUT` endpoint
- call the internal deadline `DELETE` endpoint
- translate gateway runtime events into internal deadline API requests
- surface non-success internal deadline API responses as hard errors without
  retries

This service is called from the existing gateway event paths listed below.

This service is constructed in `apps/data-plane-gateway/src/runtime/index.ts`
and receives:

- the existing `dataPlaneClient`
- the gateway clock

### 4.3 Event mapping

#### Bootstrap attach

When the bootstrap peer attaches in
`apps/data-plane-gateway/src/tunnel/session/tunnel-session-service.ts`:

- ensure any old disconnect deadline for the same sandbox is cleared
- create or replace the `idle` deadline for the current owner lease with:
  - `dueAt = now + resolvedIdleTimeoutMs`
- let the data-plane API `PUT` request schedule the idle deadline workflow

This call happens inside `attachBootstrapPeer(...)` immediately after the
runtime attachment persistence path is started.

If either deadline API call fails during bootstrap attach, the gateway treats
that failure as fatal to the bootstrap session and invokes `onFatalError(...)`
to close the websocket. The gateway does not keep the bootstrap session alive
without a durable idle deadline.

#### Presence lease touch

When a connection peer creates or renews presence in
`TunnelSessionService`:

- extend the idle deadline for the current owner lease
- increment generation
- let the data-plane API `PUT` request schedule the new delayed workflow for
  the new generation

This call happens in the same code path that currently invokes
`handlePresenceLeaseTouch(...)`.

If the deadline `PUT` call fails during presence-touch handling, the gateway
treats that failure as fatal to the current bootstrap session and closes the
bootstrap websocket. It does not silently continue with stale idle timing.

#### Keepalive activity touch

When keepalive activity is recorded in
`apps/data-plane-gateway/src/tunnel/sandbox-keepalive-repository.ts`:

- if keepalive is active, extend the idle deadline
- increment generation
- let the data-plane API `PUT` request schedule the new delayed workflow

This replaces the current `handleActivityTouch(...)` call.

If the deadline `PUT` call fails while handling a keepalive activity message,
the error is allowed to propagate through the existing websocket-message path
and the bootstrap websocket is closed as a fatal session error.

#### Bootstrap disconnect

When the bootstrap peer disconnects:

- keep clearing runtime attachment as it does today
- clear the active `idle` deadline
- create or replace the `disconnect` deadline with:
  - `dueAt = now + resolvedBootstrapDisconnectGraceMs`
- let the data-plane API `PUT` request schedule the disconnect deadline
  workflow

This replaces the current disconnect-grace timer path.

If either deadline API call fails during bootstrap disconnect, the gateway
does not swallow that failure or start a local compensating timer. The
disconnect cleanup promise rejects, and the failure is surfaced through the
existing session-teardown logging path.

#### Bootstrap reconnect during disconnect grace

When the bootstrap peer reattaches before the disconnect deadline fires:

- clear the disconnect deadline
- reactivate the idle deadline for the new or same owner lease

#### Sandbox stopped or failed

When the sandbox transitions to a terminal durable state through any worker
flow that reaches the shared terminal-state helpers changed in branch 4, the
worker clears both `idle` and `disconnect` deadlines in that same terminal
state transition.

#### Owner lease replacement

When ownership changes:

- old deadlines become stale via owner-lease mismatch and generation change
- gateway explicitly replaces the row with the new owner lease

## 5. Worker fencing rules

Deadline execution must never trust scheduled input alone.

Every deadline fire must re-read:

- the current deadline row
- the current runtime-state snapshot
- the current durable sandbox row

Execution must no-op unless:

- the row exists
- `clearedAt` is null
- row generation equals workflow input generation
- row `ownerLeaseId` equals workflow input `ownerLeaseId`
- row `dueAt` equals workflow input `dueAt`
- the runtime-state snapshot is still compatible with the row's `ownerLeaseId`

This preserves the same fencing model the current stop and reconcile code
already uses.

## 6. System Test Requirements

The final system test must verify real system correctness, not an internal
repair path.

Required scenario:

1. start a sandbox instance
2. verify PTY traffic works through client -> gateway -> sandbox
3. restart the gateway
4. wait for automatic recovery
5. verify PTY traffic works again
6. do not call internal reconcile
7. do not mutate the DB directly
8. do not call a privileged repair endpoint

This test passes because:

- `sandboxd` autonomously reconnects using the rolling exchange token
- gateway restart does not destroy idle/disconnect deadlines because they are
  durable

The system test fails only when those guarantees are broken.

### Additional test coverage

The full stack also adds:

- Rust tests for `sandboxd` reconnect behavior across bootstrap websocket loss
- worker tests for deadline generation fencing
- gateway integration tests for deadline row writes on attach, touch, and
  disconnect

The final system test file path is:

- `tests/system/sandbox-gateway-restart-resilience.system.test.ts`

The previous system test that relied on internal reconcile is deleted rather
than retained under a weaker name.

### System test design

System tests in this stack are responsible for validating user-visible
cross-service behavior through real HTTP and websocket boundaries. They are not
the place to prove every storage transition or fencing edge case.

All sandbox deadline and reconnect system tests will be built from the same
small set of shared helpers:

- `startSandboxAndWaitReady()`
  - creates a sandbox through the normal public APIs
  - waits until public sandbox status is `running`
  - waits until public sandbox status reports `connectable = true`
- `openPtyAndAssertRoundTrip(instanceId)`
  - mints a normal public sandbox connection token
  - opens a websocket to the sandbox through the gateway
  - sends a sentinel shell command containing a unique token
  - waits until the sentinel token is observed in PTY output
- `restartContainer(containerId)`
  - performs a real `docker restart` against the target service container
- `stopContainer(containerId)` and `startContainer(containerId)`
  - perform real container stop/start operations when a test needs a longer
    outage than restart provides
- `waitForSandboxStatus(instanceId, status)`
  - polls the normal public sandbox API until the durable status matches
- `waitForSandboxConnectable(instanceId, connectable)`
  - polls the normal public sandbox API until `connectable` matches
- `readSandboxRuntimeState(instanceId)`
  - performs a read-only HTTP request to the existing gateway internal route:
    - `GET /internal/sandbox-instances/:instanceId/runtime-state`
  - returns the current:
    - `ownerLeaseId`
    - `attachment`
    - `presence.activeCount`
    - `keepalive.active`
    - `runtime.ready`

System tests must not:

- call internal reconcile endpoints
- mutate the DB directly
- inspect OpenWorkflow tables directly
- use privileged repair-only APIs to force the outcome under test

Read-only inspection of internal runtime-state is allowed only for assertions
that the public API cannot express directly. It must never be used to drive
the system toward the expected outcome. In this stack, the only planned use is
the idle-eligibility assertion in the idle deadline system test.

### System tests to add

The system test suite for this work consists of these exact scenarios:

#### 1. Gateway restart resilience

File:

- `tests/system/sandbox-gateway-restart-resilience.system.test.ts`

Scenario:

1. start sandbox and wait until it is `running` and `connectable`
2. prove PTY round-trip works
3. restart the data-plane gateway container once
4. prove PTY round-trip works again

This is the primary correctness test for the stack.

#### 2. Reconnect survives token rollover

File:

- `tests/system/sandbox-gateway-restart-token-rollover.system.test.ts`

Scenario:

1. start sandbox and prove PTY round-trip works
2. restart the gateway
3. prove PTY round-trip works again
4. restart the gateway a second time
5. prove PTY round-trip works again

This test exists specifically to prove that `sandboxd` used the refreshed
`tunnelExchangeToken` returned by the first reconnect flow. A broken token
rollover implementation will typically pass the first reconnect and fail the
second.

#### 3. Reconnect clears disconnect deadline

File:

- `tests/system/sandbox-disconnect-deadline-cleared-on-reattach.system.test.ts`

Scenario:

1. start sandbox and prove PTY round-trip works
2. restart the gateway once
3. prove PTY round-trip works again
4. wait longer than `fixture.dataPlaneGatewayBootstrapDisconnectGraceMs`
5. assert sandbox is still `running`
6. assert sandbox is still `connectable`
7. prove PTY round-trip still works

This test proves that reconnect cleared or superseded the previously scheduled
disconnect deadline rather than allowing a stale reconcile to fire later.

#### 4. Idle deadline survives gateway restart

File:

- `tests/system/sandbox-idle-deadline-survives-gateway-restart.system.test.ts`

Scenario:

1. start sandbox and prove PTY round-trip works
2. close the PTY connection
3. assert through the existing read-only gateway runtime-state route that:
   - `presence.activeCount = 0`
   - `keepalive.active = false`
4. restart the gateway during the idle window
5. wait for sandbox status `stopped`

This test proves that idle timing is durable and not owned by gateway memory.

### Integration tests to add

The following behaviors are intentionally not system tests. They belong in
integration tests because they verify domain-specific storage and fencing logic
more directly than a user-visible end-to-end scenario can.

#### Gateway integration

Add gateway integration tests for:

- bootstrap attach creates or replaces the `idle` deadline row
- presence touch extends the `idle` deadline and increments `generation`
- keepalive activity extends the `idle` deadline and increments `generation`
- bootstrap disconnect clears `idle`, creates `disconnect`, and schedules the
  delayed workflow
- bootstrap reattach clears `disconnect` and creates or replaces `idle`
- owner replacement supersedes the old row with the new `ownerLeaseId`

These belong under `apps/data-plane-gateway/integration/`.

#### Worker integration

Add worker integration tests for:

- stale `generation` causes the deadline workflow to no-op
- mismatched `ownerLeaseId` or `dueAt` causes the deadline workflow to no-op
- cleared deadline row causes the deadline workflow to no-op
- `idle` deadline executes stop and then clears the `idle` row
- `disconnect` deadline executes reconcile and then clears both deadline kinds
  after terminal durable state transition
- terminal worker paths covered by branch 4 clear both deadline kinds when
  they commit `stopped` or `failed`

These belong under `apps/data-plane-worker/integration/`.

#### Rust tunnel-session tests

Add `sandboxd` Rust tests for:

- initial connect succeeds and `TunnelSession::start(...)` returns only after
  the initial session is established
- websocket loss causes the supervisor to start reconnect flow
- token exchange success rolls the stored exchange token forward
- second reconnect uses the rolled token, not the original token
- terminal token exchange responses stop the supervisor
- `TunnelSession::close(self)` stops the supervisor without reconnecting

These remain in `packages/sandboxd/src/tunnel/session.rs`.

### Test environment configuration

The system test environment must run with intentionally shortened gateway
lifecycle durations so these scenarios complete quickly while still
exercising real timing behavior.

This is implemented by gateway app config, not compile-time constants.

The system-test stack will set these gateway config env vars:

- `MISTLE_APPS_DATA_PLANE_GATEWAY_LIFECYCLE_IDLE_TIMEOUT_MS`
- `MISTLE_APPS_DATA_PLANE_GATEWAY_LIFECYCLE_BOOTSTRAP_DISCONNECT_GRACE_MS`

These shortened values are part of the real service configuration for the test
environment. They are not fake timers and do not change the production logic
paths under test.

Tests must use real boundaries and existing deterministic time abstractions
where applicable. Do not use fake timers or mocks.

## 7. Concrete Implementation Notes

### `sandboxd`

Primary files:

- `packages/sandboxd/src/tunnel/session.rs`
- `packages/sandboxd/src/sandboxd_state.rs`

Concrete changes:

- introduce a reconnect supervisor around `run_tunnel_session(...)`
- add HTTP token-exchange client logic
- persist rolling reconnect state
- make `close()` best-effort
- update the existing Rust tests in `packages/sandboxd/src/tunnel/session.rs`
  to cover reconnect after bootstrap websocket loss

### Data-plane DB

Primary files:

- `packages/db/src/data-plane/schema/*`

Concrete changes:

- add `sandbox_instance_deadlines` schema
- export deadline types
- export the new table from the existing data-plane schema barrel

### Workflow registry and worker

Primary files:

- `packages/workflow-registry/src/data-plane.ts`
- `apps/data-plane-worker/openworkflow/*`

Concrete changes:

- add deadline workflow spec
- add deadline workflow implementation
- reuse existing stop/reconcile worker services from the new workflow
- change the shared terminal-state helpers so they clear deadline rows in every
  worker flow covered by branch 4 that commits `stopped` or `failed`

### Gateway

Primary files:

- `apps/data-plane-gateway/src/tunnel/session/tunnel-session-service.ts`
- `apps/data-plane-gateway/src/tunnel/sandbox-keepalive-repository.ts`
- `apps/data-plane-gateway/src/runtime/index.ts`
- `apps/data-plane-gateway/src/deadlines/sandbox-instance-deadline-service.ts`

Concrete changes:

- replace controller calls with deadline service calls
- delete `apps/data-plane-gateway/src/idle/sandbox-idle-controller.ts`
- delete `apps/data-plane-gateway/src/idle/sandbox-idle-controller-registry.ts`
- wire the existing `dataPlaneClient` into the new deadline service

## 8. Final Expected Behavior

After all branches land:

- short gateway restarts or websocket drops do not strand a healthy sandbox
  because `sandboxd` reconnects on its own
- long disconnects still converge correctly because the durable disconnect
  deadline fires and the worker reconciles
- idle timeout still works after gateway restarts because the deadline is
  durable
- the system test proves restart resilience without internal workarounds

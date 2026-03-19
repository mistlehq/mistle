# Sandbox Connectability Ownership Proposal

## Status

Proposal for evaluation.

This proposal was triggered by a concrete issue encountered during sandbox session connection handling: the control-plane timeout used while polling for reconnect readiness diverged from the data-plane worker timeout that actually governed tunnel readiness.

Fixing that issue temporarily required synchronizing timeout values across service boundaries. That resolved the immediate symptom, but it also made the architectural problem clear: the control plane was owning reconnect wait behavior that fundamentally belongs to the data plane.

This document captures the resulting improvement proposal. It describes the current sandbox connection flow, the architectural problems in the current approach, and a proposed redesign that moves connectability and reconnect ownership fully into the data plane.

The goal is to evaluate whether this separation of responsibilities is a better long-term design before implementation is committed.

## Summary

Today, the dashboard asks the control plane to mint a sandbox connection token. The control plane then:

- reads sandbox status from the data plane
- decides whether reconnect/resume is required
- triggers resume when needed
- polls the data plane until the sandbox appears ready
- mints the gateway connection token

This works, but it creates an architectural boundary problem:

- the control plane owns public API authorization and token issuance
- the data plane owns runtime state, tunnel liveness, reconnect behavior, and readiness timeouts
- the current token-mint flow causes the control plane to make data-plane readiness decisions anyway

This introduces duplicated logic, duplicated timeout behavior, and a coupling between services that should have clearer separation.

This proposal specifically emerged from the timeout synchronization experience:

- the data plane already owned the real reconnect wait
- the control plane had its own separate polling timeout
- the two values diverged
- a temporary fix required keeping them aligned across services

That incident is the motivating example for this proposal. The proposal aims to remove the need for that kind of synchronization entirely by giving the data plane full ownership of connectability and reconnect timing.

The proposed design is:

- the control plane continues to own authorization and token issuance
- the data plane owns the full decision of whether a sandbox is connectable
- if reconnect is required, the data plane performs it and decides whether it succeeded, failed, or timed out
- the control plane only propagates the data-plane result and mints a token if the data plane says the instance is ready

## Current Architecture

### High-Level Touchpoints

Current request path for `Open session`:

1. Dashboard calls the control-plane public endpoint for sandbox connection token minting.
2. Control plane checks the sandbox instance via the data-plane internal API.
3. Control plane decides whether to:
   - wait for `starting`
   - resume `stopped`
   - reconnect `running` without a live tunnel
4. Control plane polls the data plane for readiness.
5. If the control plane decides the instance is ready, it mints a gateway connection token.
6. Dashboard uses the connection URL and token to open a websocket to the data-plane gateway.
7. Gateway validates the token and checks whether a live sandbox owner/tunnel exists.
8. If admitted, the PTY session is established.

### Current Responsibilities by Layer

Dashboard:

- requests a connection token
- opens the websocket if token minting succeeds
- shows the returned error if token minting fails

Control plane:

- authenticates and authorizes the user
- reads sandbox state from the data plane
- decides whether reconnect/resume is required
- polls for readiness
- mints gateway connection token

Data plane API:

- exposes internal `start`, `resume`, `get`, and `list` operations
- returns sandbox state snapshots

Data plane worker:

- performs resume/reconnect/start workflows
- waits for tunnel readiness
- decides failure codes and timeout outcomes during runtime recovery

Gateway:

- validates connect token
- validates that the sandbox actually has a live owner/tunnel
- admits or rejects websocket establishment

## Current Implementation Shape

At a high level, the current logic works like this:

- dashboard calls control plane `POST /v1/sandbox/instances/{id}/connection-tokens`
- control plane reads the instance from the data plane
- if `starting`, control plane polls until it appears connectable
- if `stopped`, control plane calls `resume` then polls
- if `running` but tunnel is stale, control plane calls `resume` then polls
- if `failed`, control plane returns an error
- if polling succeeds, control plane mints a gateway connection token

The worker separately owns the actual reconnect behavior:

- stopping stale runtime if needed
- resuming or recreating runtime
- waiting for tunnel readiness
- marking failure or running state

This means the control plane is not only coordinating requests, but also reproducing readiness semantics using data-plane state snapshots.

## Problem Statement

### 1. Connectability Ownership Is Split

The control plane currently determines whether a sandbox is connectable by:

- reading low-level tunnel-related fields from the data plane
- deciding whether a reconnect is required
- polling until the instance looks usable

But the data plane is the system that actually owns:

- runtime lifecycle
- tunnel liveness
- reconnect behavior
- tunnel readiness timeout policy
- reconnect failure classification

This means the control plane is making runtime-readiness decisions based on replicated state rather than owning the source of truth.

### 2. Polling Logic Lives in the Wrong Layer

The control plane currently performs a polling loop against the data-plane `get` endpoint while waiting for the sandbox to become usable.

That has several drawbacks:

- readiness semantics are duplicated
- polling criteria must stay aligned with worker behavior
- user-facing timeout errors come from the control plane, not the layer that actually waited
- control-plane behavior is coupled to low-level tunnel state fields

### 3. Timeout Values Need to Stay Synchronized

This issue became visible when the control-plane wait budget and the worker tunnel-readiness wait budget diverged.

The worker already owns the real reconnect timeout because it is the component actually waiting for the tunnel to come up. But the control plane had its own separate wait timeout while polling.

That creates two problems:

- the control plane can time out earlier than the worker and return a misleading error
- fixing it requires keeping timeout values in sync across services

This is an architectural smell. Even if the values are manually synchronized, the ownership is still wrong because the control plane is making a data-plane timing decision.

This proposal is the direct improvement identified from that experience.

### 4. Security and Responsibility Boundaries Are Blurred

From a separation-of-responsibilities perspective:

- control plane should own identity, authorization, and token issuance
- data plane should own runtime truth, reconnect behavior, and readiness semantics
- gateway should own final websocket admission

The current design causes the control plane to inspect and interpret low-level tunnel state in order to decide whether token minting is appropriate.

That does not immediately create an authorization vulnerability because gateway admission still enforces live ownership, but it weakens the service boundary and increases policy duplication.

### 5. User-Facing Errors Are Less Accurate

When reconnect fails or times out, the real decision is made in the data plane. But because the control plane is polling independently, the final error surfaced to the dashboard can be:

- stale
- misleading
- based on the control-plane wait loop rather than the real reconnect outcome

The user should ideally see the result from the component that actually performed the recovery.

## Proposed Architecture

### High-Level Idea

Move ownership of sandbox connectability into the data plane.

The control plane should stop deciding whether the instance is connectable by composing:

- `get`
- `resume`
- polling

Instead, the control plane should ask the data plane a single question:

`Ensure this sandbox instance is connectable, and return the terminal result.`

### Proposed High-Level Flow

1. Dashboard calls control plane to open a session.
2. Control plane authenticates and authorizes the user for the sandbox instance.
3. Control plane calls a new internal data-plane operation, for example `ensure-connectable`.
4. Data plane determines whether the instance is:
   - already connectable
   - still starting
   - stopped and resumable
   - running but disconnected and requiring reconnect
   - failed
   - not found or otherwise not resumable
5. If recovery is required, the data plane performs it using its own workflow and timeout policy.
6. Data plane returns a terminal result:
   - `ready`
   - `failed`
   - `timeout`
   - `not found`
   - `not resumable`
7. If the result is `ready`, control plane mints the gateway connection token.
8. Dashboard opens the websocket with that token.
9. Gateway performs final admission based on live ownership and token validation.

### Proposed Responsibilities by Layer

Dashboard:

- request connection token from control plane
- attempt websocket connection if token minting succeeds
- display propagated terminal error if token minting fails

Control plane:

- authenticate and authorize
- call data-plane `ensure-connectable`
- mint gateway token only if data plane returns `ready`
- propagate data-plane error result to dashboard

Data plane API:

- expose a terminal `ensure-connectable` internal operation
- own the decision of whether connectability already exists or recovery is required

Data plane worker:

- remain the owner of reconnect/start/resume behavior
- remain the owner of tunnel-readiness timeout and failure classification

Gateway:

- remain final admission authority for websocket establishment

## Proposed Internal API Shape

Example conceptual internal route:

- `POST /internal/sandbox-instances/ensure-connectable`

Possible request:

```json
{
  "organizationId": "org_...",
  "instanceId": "sbi_..."
}
```

Possible response:

```json
{
  "status": "ready"
}
```

or

```json
{
  "status": "error",
  "code": "RECONNECT_TIMEOUT",
  "message": "Timed out waiting for sandbox tunnel readiness."
}
```

Illustrative stable error/result codes:

- `INSTANCE_NOT_FOUND`
- `INSTANCE_FAILED`
- `INSTANCE_NOT_RESUMABLE`
- `RECONNECT_TIMEOUT`
- `RECONNECT_FAILED`

The exact schema can be adjusted, but the important part is that the data plane returns a terminal result rather than requiring the control plane to orchestrate readiness from snapshots.

## Architectural Implications

### Positive Implications

- ownership becomes cleaner and easier to reason about
- control-plane logic becomes smaller and less stateful
- timeout semantics are defined once, in the data plane
- user-facing errors become more accurate
- service boundaries better reflect runtime truth
- security posture improves through clearer separation of duties

### Tradeoffs

- the data-plane internal API becomes richer
- the internal `ensure-connectable` request may remain open longer than the current short `get` or `resume` calls
- result-code design and error propagation need care to avoid leaking unnecessary infrastructure detail
- concurrency and idempotency must be handled carefully if multiple callers request connection at once

## Alternatives Considered

### Alternative A: Keep Current Design and Synchronize Timeouts

This means:

- control plane keeps polling
- control plane keeps deciding reconnect behavior
- timeout values are explicitly synchronized with the data plane

Pros:

- smaller near-term code change
- preserves current request structure

Cons:

- ownership remains split
- duplicated readiness logic remains
- timeout synchronization becomes a maintenance burden
- user-facing error provenance remains weaker

This addresses symptoms but not the architectural issue.

### Alternative B: Expose Richer Status and Continue Polling

This means:

- add a richer `connectionStatus` or similar field
- control plane keeps polling but uses a better state model

Pros:

- improves observability
- reduces ambiguity around `running`

Cons:

- still leaves readiness orchestration in the control plane
- still duplicates timeout/polling semantics across layers
- still does not establish clear ownership of terminal reconnect results

This is better than the current model for visibility, but it does not fix the responsibility boundary.

### Alternative C: Fully Asynchronous Connectability Operation

This means:

- control plane requests connectability operation from data plane
- data plane returns an operation id
- control plane or dashboard polls operation status

Pros:

- explicit long-running workflow model
- avoids long-held request connection

Cons:

- more moving parts
- more client complexity
- heavier UX for a user action that ideally feels immediate

This may be worth considering if reconnect is expected to take long enough that synchronous waiting becomes operationally problematic. Otherwise it is likely more complexity than needed.

## Recommendation

The recommended approach is:

- add a synchronous internal data-plane `ensure-connectable` operation
- keep timeout ownership entirely in the data plane
- keep control plane focused on authorization, orchestration, and token issuance
- keep gateway as final admission authority

This is the cleanest improvement in service boundaries without forcing a more complex asynchronous operation model.

It also removes the class of issues where timeout or readiness-policy values need to be kept manually synchronized between the control plane and the data plane.

## Decision Questions

This proposal should be evaluated against the following questions:

1. Do we want the data plane to be the sole owner of reconnect timeout semantics?
2. Is a synchronous internal `ensure-connectable` call acceptable operationally for expected reconnect durations?
3. Do we want the control plane to stop interpreting low-level tunnel-liveness fields entirely?
4. Are the proposed result shapes and error boundaries sufficient for dashboard UX and debugging needs?
5. Is there any reason to prefer richer status polling over a terminal internal operation?

## Conclusion

The current approach is understandable as an incremental evolution of the existing `start`, `resume`, and `get` internal API shape, but it leaves connectability ownership split between services.

The proposed design makes the data plane the source of truth for whether a sandbox is actually connectable, while preserving the control plane as the owner of public access policy and token issuance.

That separation is cleaner architecturally, better aligned with service responsibilities, and easier to maintain over time.

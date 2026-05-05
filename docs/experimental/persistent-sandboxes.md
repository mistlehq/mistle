# Persistent Sandboxes

Persistent sandboxes let selected sandbox filesystem state survive after the sandbox compute runtime stops or expires.

This matters because sandbox providers can impose hard limits on how long a compute sandbox may run. For example, once an E2B sandbox reaches its provider time limit, the compute runtime can no longer be resumed and the filesystem state inside that runtime is no longer accessible through the sandbox itself.

Persistent sandboxes address that by decoupling compute from filesystem state. The compute sandbox can be replaced, while selected filesystem paths are kept in durable storage and reattached to new compute.

By default, sandboxes are ephemeral. When persistence is enabled for an organization and the deployment has a supported storage backend, session sandboxes can run in `persistent` mode instead. Setup-check sandboxes remain ephemeral.

## Persistent sandboxes vs snapshots

Persistent sandboxes and snapshots solve different problems.

| Feature              | What it preserves         | Scope                   | Main use case                                                            |
| -------------------- | ------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| Snapshots            | Prepared sandbox image    | Sandbox profile version | Make future sessions start from a prebuilt profile image                 |
| Persistent sandboxes | Selected filesystem paths | Sandbox instance        | Keep one sandbox's working state across compute stops or provider expiry |

Use snapshots when the same prepared environment should be reused by many future sessions. Examples include installing shared tools, applying setup scripts, or baking dependencies into the profile image.

Use persistent sandboxes when the state belongs to a specific sandbox instance and should survive compute lifecycle changes. Examples include a checked-out repository, dependency cache, generated artifacts, or agent workspace state that should remain available after provider compute is stopped or replaced.

Snapshots do not preserve ongoing per-session work. Persistent sandboxes do not create a reusable image for other sessions.

## How it works

Persistence is decided before a sandbox start workflow is queued:

1. The data-plane API asks the control-plane internal API whether persistent sandboxes are enabled for the organization.
2. The data-plane API checks whether the runtime provider and configured storage backend are compatible.
3. The sandbox instance is created with either `ephemeral` or `persistent` mode.
4. The data-plane worker provisions storage, starts compute, and attaches the storage before runtime initialization.

Supported combinations today:

| Runtime provider | Storage backend |
| ---------------- | --------------- |
| `e2b`            | `archil`        |
| `docker`         | `docker_volume` |

The persistent storage layout currently binds:

| Storage path | Sandbox path |
| ------------ | ------------ |
| `root`       | `/root`      |
| `etc/codex`  | `/etc/codex` |

That means persistence is intentionally scoped. It is not a full snapshot of the whole sandbox filesystem.

## Compute and storage flow

```text
Start sandbox request
      │
      ▼
Control plane resolves org storage setting
      │
      ▼
Data plane chooses persistence mode
      │
      ▼
Worker provisions storage if persistent
      │
      ▼
Worker prepares provider-specific storage startup
      │
      ▼
Sandbox compute starts
      │
      ▼
Worker attaches storage before sandbox runtime init
      │
      ▼
Sandbox runs with persisted `/root` and `/etc/codex`
      │
      ▼
Provider compute stops, expires, or is replaced
      │
      ▼
Durable storage remains available for a later sandbox
```

For E2B, Mistle provisions an [Archil](https://docs.archil.com/) disk, stores the disk handle in the data-plane database, encrypts the disk token through the control-plane internal API, and mounts the disk into the sandbox during attach.

For Docker, Mistle provisions a Docker volume, stores the volume name in the data-plane database, and starts the sandbox container with volume subpath mounts.

## Stop and resume behavior

Stopping a persistent sandbox stops the compute runtime but does not delete the storage row or durable storage by default. On the next resume/start path for that sandbox instance, Mistle resolves the existing storage record and reattaches it.

If provider compute is missing during reconciliation, persistent sandboxes are marked stopped so they can be resumed against their durable state. Ephemeral sandboxes are treated as failed in that situation because there is no durable state to recover.

Storage is deprovisioned when persistent sandbox startup fails after storage was created, and on destructive teardown paths where the sandbox instance is being fully cleaned up.

## Why it matters

Persistent sandboxes reduce repeated setup cost for workflows that benefit from retained workspace state, such as cloned repositories, dependency caches, generated build artifacts, and long-running project setup.

They also make provider compute limits less disruptive. If a provider expires or deletes the compute runtime, the selected filesystem state can still be available through the storage backend.

## Experimental limits

Persistent sandboxes are experimental because the implementation is still intentionally narrow:

Important considerations:

- persisted state is scoped to the sandbox instance
- persisted paths are currently `/root` and `/etc/codex`
- secrets should still not be written directly into the sandbox
- storage backends add cost and lifecycle management
- workflows must not assume a persistent sandbox starts empty
- some edge cases around cleanup, partial attachment, provider failures, and state drift are still being hardened

Persistent sandboxes should be used where preserved workspace state is valuable enough to justify the additional storage lifecycle, cleanup, and isolation considerations.

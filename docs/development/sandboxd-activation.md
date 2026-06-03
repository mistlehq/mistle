# Sandboxd Activation

`sandboxd activate` is the single sandboxd lifecycle command. Callers send the same activation payload shape for every sandboxd lifecycle operation, and sandboxd decides from daemon-local state whether it needs first activation work or an activated-state refresh.

Callers should not choose a separate sandboxd init, wait-init, or resume path. Provider compute resume is still a provider operation: it starts or reconnects provider-owned sandbox compute. Once provider compute is available, the caller activates sandboxd with the desired operation kind.

## Operation Kinds

`start` activates an interactive session sandbox. Sandboxd applies the runtime plan when needed, starts or attaches the session runtime resources, starts runtime proxies, starts the tunnel, and only reports readiness through the runtime readiness contract after the supervised runtime path is healthy.

`resume` refreshes an existing interactive session sandbox after provider compute has resumed. It uses the same activation payload shape as `start`; sandboxd owns refreshing tunnel/session credentials and live daemon resources that can be safely refreshed without changing the runtime plan.

`setup_check` activates a sandbox used to verify setup behavior for a profile version. It uses the activation path so setup checks exercise the same runtime-plan materialization and runtime readiness contract as session startup.

`snapshot` activates a one-off snapshot materialization sandbox. Sandboxd applies the compiled snapshot preparation runtime plan and preparation script for image capture, then the caller captures the provider image and destroys the sandbox. Initial snapshots and setup refreshes prepare from the setup script; maintenance refresh snapshots prepare from the saved snapshot maintenance script when one is configured and a usable current snapshot exists. Scheduled refresh uses setup preparation from the base image when those maintenance prerequisites are not met.

## Runtime Plan Changes

Activation is idempotent for an exact matching accepted activation payload. An already activated daemon rejects runtime plan changes unless a future refresh path can apply the candidate runtime plan before accepting it. This keeps the accepted activation input aligned with the live runtime environment, processes, proxies, adapters, and readiness state.

## Provider Resume

Provider resume is not a sandboxd lifecycle command. Docker, E2B, Tensorlake, and future providers may preserve different subsets of state when provider compute stops. The provider layer is responsible for making compute reachable again; sandboxd is responsible for activating or refreshing its daemon-local runtime resources after compute is reachable.

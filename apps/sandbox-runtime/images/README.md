# Sandbox Images

This directory contains container image definitions used by `@mistle/sandbox-runtime`.

## Layout

- `base/`: canonical base image for sandbox runtime responsibilities

## Notes

- The base image builds `sandbox-bootstrap` and `sandboxd` from `apps/sandbox-runtime`.
- The base image starts `sandbox-bootstrap`, which can install an injected proxy CA certificate and then drops privileges before execing `sandboxd`.
- `sandboxd` now expects startup JSON on stdin with `bootstrapToken`, `tunnelGatewayWsUrl`, and `runtimePlan`.
- `sandboxd` keeps the bootstrap token in memory and establishes a websocket tunnel to data-plane-gateway.
- `sandboxd` exposes `/egress/routes/{routeId}` and forwards to tokenizer proxy egress.
- Build this image with repository root as context:
  - `docker build -f apps/sandbox-runtime/images/base/Dockerfile .`
- A root `.dockerignore` is used to keep build context small.

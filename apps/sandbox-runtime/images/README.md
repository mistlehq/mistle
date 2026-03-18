# Sandbox Images

This directory contains container image definitions used by the sandbox runtime.

## Layout

- `base/`: canonical base image for sandbox runtime responsibilities

## Notes

- `base/Dockerfile` has two runtime families:
  - `sandbox-base-*` targets package the Go runtime from `apps/sandbox-runtime`
  - `sandbox-base-node-*` targets package the SEA binaries from `apps/sandbox-runtime-node`
- Both runtime families start the sandbox bootstrap entrypoint, which generates and trusts a per-sandbox proxy CA before dropping privileges and execing the runtime binary.
- The runtime binary expects startup JSON on stdin with `bootstrapToken`, `tunnelGatewayWsUrl`, and `runtimePlan`.
- The runtime binary keeps the bootstrap token in memory, establishes a websocket tunnel to data-plane-gateway, and exposes the outbound HTTP(S) proxy.
- Build these images with repository root as context:
  - `docker build --target sandbox-base-dev -f apps/sandbox-runtime/images/base/Dockerfile .`
  - `docker build --target sandbox-base-node-dev -f apps/sandbox-runtime/images/base/Dockerfile .`
- Before building `sandbox-base-node-*`, generate Linux SEA artifacts into `apps/sandbox-runtime-node/dist-sea`:
  - `pnpm build:sandbox-runtime:sea:linux`
- A root `.dockerignore` is used to keep build context small.

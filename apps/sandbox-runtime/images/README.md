# Sandbox Images

This directory contains container image definitions used by the sandbox runtime.

## Layout

- `base/`: canonical base image for sandbox runtime responsibilities

## Notes

- `base/Dockerfile` packages the Node SEA sandbox runtime from `apps/sandbox-runtime-node`.
- `sandbox-base-*` is the canonical image family.
- `sandbox-base-node-*` remains as a compatibility alias for the same Node image family.
- The image starts the sandbox bootstrap entrypoint, which generates and trusts a per-sandbox proxy CA before dropping privileges and execing the runtime binary.
- The runtime binary expects startup JSON on stdin with `bootstrapToken`, `tunnelGatewayWsUrl`, and `runtimePlan`.
- The runtime binary keeps the bootstrap token in memory, establishes a websocket tunnel to data-plane-gateway, and exposes the outbound HTTP(S) proxy.
- Build these images with repository root as context:
  - `docker build --target sandbox-base-dev -f apps/sandbox-runtime/images/base/Dockerfile .`
- `sandbox-base-node-dev` resolves to the same Node runtime image if a caller still requests it explicitly.
- Before building the image, generate Linux SEA artifacts into `apps/sandbox-runtime-node/dist-sea`:
  - `pnpm build:sandbox-runtime:sea:linux`
- A root `.dockerignore` is used to keep build context small.

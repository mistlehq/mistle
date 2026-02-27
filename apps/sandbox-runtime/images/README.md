# Sandbox Images

This directory contains container image definitions used by `@mistle/sandbox-runtime`.

## Layout

- `base/`: canonical base image for sandbox runtime responsibilities

## Notes

- The base image builds and runs `sandboxd` from `apps/sandbox-runtime`.
- `sandboxd` now expects a bootstrap token on startup stdin and keeps it in memory.
- Build this image with repository root as context:
  - `docker build -f apps/sandbox-runtime/images/base/Dockerfile .`
- A root `.dockerignore` is used to keep build context small.

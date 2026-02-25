# Sandbox Images

This directory contains container image definitions used by `@mistle/sandbox`.

## Layout

- `base/`: canonical base image for sandbox runtime responsibilities

## Notes

- The base image builds and runs `sandboxd` from `apps/sandbox-runtime`.
- Build this image with repository root as context:
  - `docker build -f packages/sandbox/images/base/Dockerfile .`
- A root `.dockerignore` is used to keep build context small.

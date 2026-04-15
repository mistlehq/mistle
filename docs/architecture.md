# Architecture

## Overview

Mistle is organized as a set of cooperating services rather than a single process. The platform separates product-facing configuration and orchestration concerns from runtime execution and connectivity concerns.

At a high level:

```text
Browser
  |
  v
dashboard -> control-plane-api -> control-plane-worker
                                |
                                v
                      data-plane-api -> data-plane-worker
                                |
                                v
                        data-plane-gateway -> sandbox/runtime services
```

## Why The Split Exists

Mistle treats agent work as runtime work, not just request-response application logic.

- The control plane is responsible for product state, configuration, and orchestration inputs.
- The data plane is responsible for runtime execution, sandbox lifecycle, and session connectivity.
- The gateway sits on the runtime path for sandbox and session-related communication.
- Workers exist in both planes so asynchronous flows and lifecycle operations do not have to run inside synchronous API request paths.

This separation keeps product configuration and background execution concerns distinct and makes it clearer where interactive traffic and runtime-state management belong.

## Core Runtime Services

- `apps/dashboard`
  Browser UI for configuring integrations, sandbox profiles, sessions, and automations.
- `apps/control-plane-api`
  Control-plane HTTP API for product-facing operations.
- `apps/control-plane-worker`
  Background workflows and orchestration for control-plane actions.
- `apps/data-plane-api`
  Data-plane HTTP API.
- `apps/data-plane-worker`
  Background workflows for runtime lifecycle and execution-related operations.
- `apps/data-plane-gateway`
  Gateway for sandbox and session connectivity.
- `apps/tokenizer-proxy`
  Tokenizer support service used by the platform.

## Shared Packages

Shared packages provide most of the reusable contracts and support code across the system:

- `packages/config`
- `packages/db`
- `packages/integrations-core`
- `packages/integrations-definitions`
- `packages/sandbox-runtime-contract`
- `packages/sandbox-session-client`
- `packages/sandbox-session-protocol`
- `packages/telemetry`
- `packages/test-harness`
- `packages/ui`
- `packages/workflow-registry`

## Product Concepts And Where They Fit

- **Integrations**
  Define which external systems and model providers Mistle can use.
- **Sandbox profiles**
  Define the environment, tools, and permissions available to agent work.
- **Sessions**
  Represent interactive agent work against real repositories and connected systems.
- **Automations**
  Represent event-driven execution triggered by external events such as webhooks.

These concepts show up in the dashboard and control-plane flows, but execution depends on the data-plane services and runtime path.

## Operating Assumptions

- Mistle should be understood as a distributed application, even in local development.
- Operators need to provide surrounding infrastructure, networking, secrets, and environment-specific configuration.
- Local development uses Docker-backed dependencies and a Cloudflare tunnel for stable hostnames.
- Deployment packaging exists for Kubernetes environments, but deployment decisions still depend on the operator's infrastructure and exposure model.

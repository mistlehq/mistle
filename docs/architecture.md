# Architecture

## Overview

Mistle is organized as a set of cooperating services rather than a single process. The platform separates product-facing configuration and orchestration concerns from runtime execution, connectivity, and outbound access concerns.

At a high level:

```text
+--------------------------------------------------------------+
|                        Control Plane                         |
|  dashboard | control-plane-api | control-plane-worker        |
+--------------------------------------------------------------+
                              |
                              | starts / configures work
                              v
+--------------------------------------------------------------+
|                          Data Plane                          |
|  data-plane-api | data-plane-worker | data-plane-gateway     |
+--------------------------------------------------------------+
                              |
                              | provisions / connects runtime
                              v
+--------------------------------------------------------------+
|                Sandbox / Runtime Environment                 |
|           agent runtime | filesystem | tools                |
+--------------------------------------------------------------+
                |                                |
                | runtime connectivity           | outbound requests
                v                                v
        data-plane-gateway                tokenizer-proxy
                                                 |
                                                 | egress grants +
                                                 | route policy +
                                                 | credential injection
                                                 v
                              GitHub / Slack / Jira / SigNoz / OpenAI
```

## Why The Split Exists

Mistle treats agent work as runtime work, not just request-response application logic.

- The control plane is responsible for product state, configuration, and orchestration inputs.
- The data plane is responsible for sandbox startup, lifecycle, runtime execution, and runtime connectivity.
- The gateway sits on the runtime path for sandbox tunnels, token exchange, runtime-state access, and interactive stream routing.
- The tokenizer proxy sits on the outbound egress path for sandboxed runtimes.
- Worker processes exist in both planes so orchestration and lifecycle flows do not have to run inside synchronous API request paths.

This separation keeps product configuration and orchestration distinct from sandbox execution, runtime traffic, and controlled outbound access.

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
  Background workflows for sandbox startup, lifecycle, and runtime execution-related operations.
- `apps/data-plane-gateway`
  Gateway for sandbox tunnels, runtime-state access, interactive stream routing, and related runtime traffic.
- `apps/tokenizer-proxy`
  Sandbox egress service that enforces route policy and injects integration credentials before forwarding outbound requests upstream.

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
  Define the tools, permissions, environment, and agent configuration available to a run.
- **Sessions**
  Start interactive agent work such as debugging, code review, and repository changes.
- **Automations**
  Start background execution from external events such as webhooks.

These concepts show up in the dashboard and control-plane flows, but execution depends on the data-plane services and runtime path.

## Operating Assumptions

- Mistle should be understood as a distributed application, even in local development.
- Operators need to provide surrounding infrastructure, networking, secrets, and environment-specific configuration.
- Local development uses Docker-backed dependencies and a Cloudflare tunnel for stable hostnames.
- Integration targets must be synced into the control-plane database before the dashboard can expose them for local use.
- Deployment packaging exists for Kubernetes environments, but deployment decisions still depend on the operator's infrastructure and exposure model.

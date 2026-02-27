# Backend Integration Environment

Integration environment composition helpers for backend-dependent tests.

## Consumer Boundaries

Use this environment from:

- `apps/dashboard`
- `tests/system`
- `tests/e2e`

Do not import this environment from backend app workspaces (`apps/control-plane-api`, `apps/control-plane-worker`, `apps/data-plane-*`). Backend app integration tests should use app-local fixtures composed from `@mistle/test-core` to avoid dependency cycles.

Current scope:

- Control-plane integration environment (`control-plane/*`)

## Maintainer Source of Truth

For capability/component maintenance, edit only:

- `src/environment/backend-integration/control-plane/catalog.ts`

This file is the only place that should be manually changed for:

- capability list
- component list
- capability-to-component map

Everything else (types/resolution/runtime wiring) derives from that catalog.

## Public API (Current)

Exported via `@mistle/test-environments`:

- `IntegrationCapabilities`
- `IntegrationComponents`
- `resolveIntegrationComponents(...)`
- `startIntegrationEnvironment(...)`

Control-plane types:

- `IntegrationCapability`
- `IntegrationComponent`
- `StartIntegrationEnvironmentInput`
- `IntegrationEnvironment`

## Capabilities

The environment starts required components based on requested capabilities:

- `auth-otp`
- `members-directory`
- `members-invite-email`
- `sandbox-profiles-crud`
- `sandbox-profile-delete-async`

To inspect resolved infrastructure for a capability set:

```ts
import { resolveIntegrationComponents } from "@mistle/test-environments";

const components = resolveIntegrationComponents(["sandbox-profiles-crud"]);
```

## Usage

`startIntegrationEnvironment(...)` composes shared infra and starts app runtimes automatically:

- Starts Postgres + PgBouncer automatically.
- Starts Mailpit automatically when selected capabilities require it.
- Returns `request(...)` for in-process API calls and `stop()` for teardown.

Example:

```ts
import { startIntegrationEnvironment } from "@mistle/test-environments";

const env = await startIntegrationEnvironment({
  capabilities: ["members-directory"],
});

try {
  const response = await env.request("/__healthz");
  // assertions...
} finally {
  await env.stop();
}
```

## Lifecycle and Validation Rules

- Fail-fast: empty capability list throws.
- Fail-fast: explicit empty `workflowNamespaceId` throws.
- Teardown runs in reverse startup order.
- Calling `stop()` twice throws.

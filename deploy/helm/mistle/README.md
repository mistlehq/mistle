# Mistle Helm Chart

This chart is the public Kubernetes packaging boundary for Mistle.

It describes how to run Mistle on an existing Kubernetes cluster. It does not provision the cluster or the surrounding cloud infrastructure.

## Scope

- Deployments and Services for the Mistle workloads
- optional public Ingress objects for `control-plane-api` and `data-plane-gateway`
- optional in-cluster `valkey`
- environment-variable wiring
- Kubernetes Secret references for sensitive configuration

## Out Of Scope

- cloud project provisioning
- Kubernetes cluster provisioning
- DNS zone creation
- TLS certificate issuance
- managed Postgres or Valkey provisioning
- secret value management

## Operator Contract

The operator is responsible for:

- provisioning a Kubernetes cluster
- publishing the required container images
- supplying Mistle configuration via `env` and `secretEnv`
- creating Kubernetes Secrets or an external secret-sync mechanism
- choosing ingress controller, DNS, database, and secret-management approach

This chart intentionally stays generic so it can work for both self-hosting users and Mistle Cloud.

## Values Model

Each workload exposes the same main configuration surface:

- `image`
- `replicaCount`
- `containerPort`
- `service`
- `ingress` where relevant
- `env`
- `secretEnv`
- `resources`

For Mistle service images, `global.imageRegistry` is prepended by default. Third-party images can opt out with `image.useGlobalRegistry: false`; the bundled `valkey` workload already does this.

`env` is a list of plain environment variables:

```yaml
env:
  - name: NODE_ENV
    value: production
```

`secretEnv` is a list of Kubernetes Secret references:

```yaml
secretEnv:
  - name: MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL
    secretName: mistle-runtime
    secretKey: MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL
```

The chart does not assume any particular secret backend. Operators can create the backing Kubernetes Secret directly or sync it from another system.

## Internal Service Naming

Service names follow this pattern:

- `<release-name>-mistle-control-plane-api`
- `<release-name>-mistle-data-plane-api`
- `<release-name>-mistle-data-plane-gateway`
- `<release-name>-mistle-tokenizer-proxy`
- `<release-name>-mistle-valkey`

If your release name is `mistle`, the internal control-plane API URL becomes:

```text
http://mistle-control-plane-api:8080
```

## Files

- `values.yaml`: baseline chart contract
- `values-example.yaml`: example operator-facing configuration
- `templates/`: workload resources

## Current State

This is the initial chart scaffold. It now defines deployable workload resources, but it does not yet include every convenience expected from a mature production chart.

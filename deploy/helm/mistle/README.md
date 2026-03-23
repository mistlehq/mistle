# Mistle Helm Chart

This chart packages Mistle for Kubernetes.

## Values Model

Each workload uses the same main configuration surface:

- `image`
- `replicaCount`
- `containerPort`
- `service`
- `ingress` where relevant
- `env`
- `secretEnv`
- `volumeMounts`
- `volumes`
- `readinessProbe`
- `livenessProbe`
- `startupProbe`
- `resources`

For Mistle service images, `global.imageRegistry` is prepended by default. Third-party images can opt out with `image.useGlobalRegistry: false`. The bundled `valkey` workload already does this.

The official published Mistle images live under the shared public GHCR prefix:

```text
ghcr.io/mistlehq
```

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

## Workloads

- `control-plane-api`
- `control-plane-worker`
- `data-plane-api`
- `data-plane-worker`
- `data-plane-gateway`
- `tokenizer-proxy`
- optional `valkey`

## Service Naming

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

## Included Files

- `values.yaml`: baseline chart contract
- `values-example.yaml`: example operator-facing configuration
- `values-local.yaml`: repo-local OrbStack/compose smoke-test configuration
- `templates/`: workload resources

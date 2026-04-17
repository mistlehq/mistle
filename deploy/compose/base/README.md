# Base Compose Layer

`deploy/compose/base/compose.yaml` defines the shared service topology for Compose-based Mistle environments.

It is intentionally limited to:

- core Mistle services
- shared backing services required in every mode
- networks, volumes, and healthchecks
- shared runtime contracts such as `MISTLE_CONFIG_PATH`

It must not contain environment-specific policy such as:

- localhost port bindings
- Mailpit defaults
- SeaweedFS defaults
- callback-capable local setup
- production ingress or TLS policy

The first supported overlay is `deploy/compose/local/compose.yaml`.

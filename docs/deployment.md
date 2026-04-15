# Deployment

## Overview

Mistle is deployed as a multi-service system. The repository includes Kubernetes packaging, but deployment still requires environment-specific decisions about infrastructure, networking, secrets, and exposure.

## Deployment Shape

At a minimum, operators should expect to reason about:

- dashboard access
- control-plane APIs and workers
- data-plane APIs and workers
- gateway connectivity for runtime and session traffic
- supporting infrastructure such as databases, secrets, and environment configuration

Mistle should be treated as an integrated platform deployment rather than a single application process.

## Kubernetes Packaging

Kubernetes application packaging for Mistle lives under:

- `deploy/helm/mistle/`

Use this chart as the starting point for Kubernetes-based deployment.

For repo-local Helm smoke testing against OrbStack and the compose-backed development dependencies, start from:

- `deploy/helm/mistle/values-local.yaml`

## Operator Responsibilities

This repository provides application code and packaging, but operators still need to supply:

- environment-specific configuration
- secret management
- network and ingress decisions
- external hostname and connectivity strategy
- infrastructure lifecycle and observability

The right production setup depends on the environment where Mistle will run and the systems it must connect to.

## Development Versus Deployment

Local development uses Docker-backed dependencies and a Cloudflare tunnel for stable hostnames. That is a development convenience and not a substitute for a production deployment plan.

Use [docs/local-development.md](local-development.md) for the developer setup flow and [docs/architecture.md](architecture.md) for the service layout and control-plane/data-plane split.

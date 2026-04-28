# Mistle

Mistle is an open-source platform for running and automating sandboxed coding agents.

## How Mistle Works

- **Integrations** connect external systems and models such as GitHub, Slack, and OpenAI.
- **Sandbox profiles** define the tools, permissions, and environment an agent starts with.
- **Snapshots** capture prepared sandbox environments so sessions can start quickly with the required tools, dependencies, and configuration already in place.
- **Sessions** start interactive agent work such as debugging, code review, and repository changes.
- **Automations** respond to external events, such as webhook deliveries from connected systems.

## Architecture

Mistle is split into control-plane and data-plane services.

- **Separate configuration from execution:** The dashboard, control-plane APIs, and control-plane workflows manage integrations, sandbox profiles, sessions, and automation setup, while data-plane APIs and workflows handle sandbox startup, lifecycle, and runtime execution.
- **Treat runtime traffic as a dedicated path:** The data-plane gateway handles sandbox tunnels, token exchange, runtime-state access, interactive stream routing, and other runtime connectivity concerns.
- **Tokenizer proxy:** The tokenizer proxy is the sandbox egress service. It mediates outbound requests from runtime environments, enforces egress grants and route policy, and resolves and injects integration credentials before forwarding traffic to upstream systems.

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
|               agent runtime | filesystem | tools             |
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

## Security Model

Mistle is built around isolated agent execution and explicit configuration.

- **Sandboxed execution:** Coding agents run in sandboxed environments.
- **Explicit configuration:** Sandbox profiles define the tools, permissions, environment settings, and agent configuration available to each run.
- **Separated runtime services:** Control-plane services handle configuration and orchestration, while runtime execution is delegated to data-plane and sandbox-related services.
- **Integration boundaries:** Access to external systems is provided through configured integrations.
- **Controlled outbound access:** External requests from runtime environments flow through the tokenizer proxy, which enforces egress grants, route policy, and credential injection before forwarding traffic upstream.

## Run Mistle Locally

There are two supported ways to run Mistle locally:

| Option                     | Use this when...                                                            | Start here                                     |
| -------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| Contributor workflow       | You are developing inside the monorepo and want the normal local dev setup. | [CONTRIBUTING.md](CONTRIBUTING.md)             |
| Single-node Docker Compose | You want to run Mistle on one machine for local testing.                    | [deploy/compose/local/](deploy/compose/local/) |

Single-node Docker Compose is the easiest way to run Mistle on one machine for local testing:

```bash
git clone https://github.com/mistlehq/mistle.git

# Start the single-node Docker Compose stack
cd mistle/deploy/compose/local
./up.sh

# Stop the stack when you're done
./down.sh
```

## Deploy Mistle

Mistle is deployed as a multi-service system. The repository includes Kubernetes packaging, but deployment still requires environment-specific decisions about infrastructure, networking, secrets, and exposure.

At a minimum, operators should expect to reason about:

- dashboard access
- control-plane APIs and workers
- data-plane APIs and workers
- gateway connectivity for runtime and session traffic
- supporting infrastructure such as databases, secrets, and environment configuration

Mistle should be treated as an integrated platform deployment rather than a single application process.

### Deployment Options

| Option              | Use this when...                                                    | Start here                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes          | You want the main cluster-based deployment path in this repository. | [deploy/helm/mistle/](deploy/helm/mistle/). For repo-local Helm smoke testing, start with [deploy/helm/mistle/values-local.yaml](deploy/helm/mistle/values-local.yaml). |
| Self-hosted Compose | You want a separate self-hosted Compose deployment artifact.        | Not implemented yet in this repository.                                                                                                                                 |

## Releases

- [Release process](docs/release-process.md)

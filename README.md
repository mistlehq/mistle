# Mistle

Mistle is an open-source platform for building and running sandboxed coding agents.

[Architecture](docs/architecture.md) | [Local development](docs/local-development.md) | [Deployment](docs/deployment.md) | [Release process](docs/release-process.md)

## How Mistle Works

- **Integrations** connect external systems and models such as GitHub, Slack, and OpenAI.
- **Sandbox profiles** define the tools, permissions, and environment an agent starts with.
- **Sessions** let people launch interactive agent work for tasks like investigating bugs or reviewing pull requests.
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

More detail lives in [docs/architecture.md](docs/architecture.md).

## Security Model

Mistle is built around isolated agent execution and explicit configuration.

- **Sandboxed execution:** Coding agents run in sandboxed environments.
- **Explicit configuration:** Sandbox profiles define the tools, permissions, environment settings, and agent configuration available to each run.
- **Separated runtime services:** Control-plane services handle configuration and orchestration, while runtime execution is delegated to data-plane and sandbox-related services.
- **Integration boundaries:** Access to external systems is provided through configured integrations.
- **Controlled outbound access:** External requests from runtime environments flow through the tokenizer proxy, which enforces egress grants, route policy, and credential injection before forwarding traffic upstream.

## Quick Start

For local development:

1. Enter the Nix development shell:

```bash
nix develop
```

2. Install dependencies:

```bash
pnpm install
```

3. Copy local environment files:

```bash
cp sample.env.dev .env.dev
cp sample.env.test .env.test
```

4. Create a named Cloudflare tunnel and DNS routes:

```bash
cloudflared tunnel create <tunnel-name>
cloudflared tunnel route dns <tunnel-name> <control-plane-api-hostname>
cloudflared tunnel route dns <tunnel-name> <data-plane-gateway-hostname>
cloudflared tunnel route dns <tunnel-name> <tokenizer-proxy-hostname>
```

5. Fill the required tunnel values in `.env.dev`:

```bash
cloudflared tunnel token <tunnel-name>
```

```env
CLOUDFLARE_TUNNEL_TOKEN=<token-from-command-above>
CONTROL_PLANE_API_TUNNEL_HOSTNAME=<control-plane-api-hostname>
DATA_PLANE_API_TUNNEL_HOSTNAME=<data-plane-gateway-hostname>
TOKENIZER_PROXY_TUNNEL_HOSTNAME=<tokenizer-proxy-hostname>
```

6. Start the stack:

```bash
pnpm dev
```

`pnpm dev` brings up local infra, runs control-plane migrations, and starts a named Cloudflare tunnel with stable hostnames.

For the complete local setup and daily development workflow, see [docs/local-development.md](docs/local-development.md).

### Validation

```bash
pnpm format
pnpm lint
pnpm lint:spelling
pnpm typecheck
pnpm test
```

Additional testing guidance lives in [docs/testing/no-mocking.md](docs/testing/no-mocking.md) and [docs/testing/property-based-testing.md](docs/testing/property-based-testing.md).

## Deployment

Deployment guidance lives in [docs/deployment.md](docs/deployment.md). Kubernetes packaging for Mistle lives under `deploy/helm/mistle/`.

## Releases

Release process documentation lives in [docs/release-process.md](docs/release-process.md).

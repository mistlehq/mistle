# Architecture

Mistle is split into control-plane and data-plane services.

- **Control plane**: The dashboard, control-plane APIs, and control-plane workflows manage integrations, sandbox profiles, sessions, and automation setup, while data-plane APIs and workflows handle sandbox startup, lifecycle, and runtime execution.
- **Data plane**: The data-plane gateway handles sandbox tunnels, token exchange, runtime-state access, interactive stream routing, and other runtime connectivity concerns.

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
|                  Sandbox (Docker / remote)                   |
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

## Credentialless sandboxes

Mistle is built around isolated agent execution and explicit configuration. Sandboxes are credentialless by default. This means that any supported integration that is configured with credentials will not have these credentials set inside the sandboxes directly (no setting environment variables, dotenv files etc.).

Instead, HTTP requests are routed through the Tokenizer Proxy that lives outside the sandbox. The Tokenizer Proxy resolves the right credentials and injects them at request-time. This ensures that agents never see sensitive credentials accidentally (or intentionally).

```text
+----------------------+     credentialless HTTP request     +----------------------+     authorized upstream request    +----------------------+
|       Sandbox        | ----------------------------------> |   Tokenizer Proxy    | ---------------------------------> |   Upstream System    |
|    agent runtime     |                                     |   egress policy +    |                                    | GitHub, Slack, Jira, |
+----------------------+                                     | credential injection |                                    | SigNoz, OpenAI, ...  |
                                                             +----------------------+                                    +----------------------+
                                                                       ^
                                                                       |
                                                              credential lookup
                                                                       |
                                                                       v
                                                           +---------------------------+
                                                           |      Control Plane        |
                                                           | integration credentials   |
                                                           +---------------------------+
```

NOTE: this doesn't prevent you from actually putting secrets directly into the sandbox environment. You are free to do so based on your security posture.

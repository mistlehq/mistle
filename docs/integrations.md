# Integrations

Integrations let agents interact with external systems without placing long-lived credentials inside the sandboxes where agents perform tasks.

Examples of what integrations enable:

- agents can respond to you in Slack
- agents can do work and open pull requests on GitHub, attributed through linked accounts when configured
- agents can inspect logs and traces in Datadog to triage issues

## Access and credentials

Integrations let teams safely manage the credentials and access granted to agents. Secrets are encrypted with organization-scoped keys, protected by master encryption keys unique to each Mistle deployment.

## Tools

When possible, Mistle installs official provider tools in sandboxes so agents can interact with connected systems through the provider-supported interface.

When an official tool is unavailable or not well-suited for agent workflows, Mistle uses maintained CLI tools built for those integrations. Those tools live in [mistlehq/tools](https://github.com/mistlehq/tools).

## Further reading

Refer to [docs/architecture.md](./architecture.md) for more details about credentialless sandboxes and caveats.

Refer to [packages/integrations-core/README.md](../packages/integrations-core/README.md) for technical and design details of the integrations API.

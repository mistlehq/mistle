# About Mistle

Mistle is an open-source platform for running and automating sandboxed coding agents.

## Features

- **Integrations** connect external systems and models such as GitHub, Slack, and OpenAI.
- **Identity attribution** links users to external accounts so work can be attributed to the right person.
- **Sandbox profiles** define the tools, permissions, and environment an agent starts with.
- **Snapshots** capture prepared sandbox environments so sessions can start quickly with the required tools, dependencies, and configuration already in place.
- **Sessions** start interactive agent work such as debugging, code review, and repository changes.
- **Automations** respond to external events, such as webhook deliveries from connected systems.

## Run Mistle locally

You can spin up Mistle easily, assuming you have Docker installed:

```bash
curl -fsSL https://raw.githubusercontent.com/mistlehq/mistle/main/deploy/compose/local/install.sh | sh
```

The script:

- Runs [deploy/compose/local/install.sh](deploy/compose/local/install.sh).
- Installs the local Docker Compose files into `~/.mistle/local`.
- Creates `~/.mistle/local/.env` from `.env.example` if it does not exist.
- Preserves an existing `~/.mistle/local/.env`.
- Starts Mistle by running `~/.mistle/local/up.sh`.

## Other notes

- Mistle is still early, so do expect bugs.
- We are currently not accepting contributions yet.
- Bug reports, feature requests, etc. are still welcome though! Please feel free to open an issue.

## Architecture

Refer to [docs/architecture.md](./docs/architecture.md).

## Local development

If you want to run the dev stack locally, refer to [CONTRIBUTING.md](CONTRIBUTING.md).

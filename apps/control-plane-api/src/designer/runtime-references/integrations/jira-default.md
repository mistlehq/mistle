<!-- Generated from the Mistle integration registry. Do not edit by hand. Run pnpm --filter @mistle/control-plane-api designer:integration-catalog:generate. -->

# Jira

Provider family ID: `jira`
Integration target key: `jira-default`
Variant ID: `jira-default`
Binding kind: `connector`
Description: Enable Jira issue access, trigger, and optional Jira CLI in sandbox.

Setup methods:

- `jira-personal-api-token` (form): Personal API token
- `jira-service-account-api-token` (form): Service account API token
- `jira-service-account-oauth-client-credentials` (form): Service account OAuth client credentials

Binding tools:

- `jira-cli`: Jira CLI (default)
- `jira-mcp`: Jira MCP

Trigger events:

- `jira:issue_created`: Issue created
- `jira:issue_updated`: Issue updated
- `comment_created`: Comment created
- `comment_updated`: Comment updated

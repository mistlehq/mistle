<!-- Generated from the Mistle integration registry. Do not edit by hand. Run pnpm --filter @mistle/control-plane-api designer:integration-catalog:generate. -->

# Sentry

Provider family ID: `sentry`
Integration target key: `sentry-default`
Variant ID: `sentry-default`
Binding kind: `connector`
Description: Enable Sentry issue webhooks and hosted MCP access.

Setup methods:

- `oauth2-authorization-code` (redirect): Sentry MCP OAuth
- `sentry-webhook-signing-secret` (form): Sentry webhooks

Binding tools:

- `sentry-mcp`: Sentry MCP (default)

Trigger events:

- `sentry.issue.created`: Issue created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data.issue}}`, `{{payload.data.issue.id}}`, `{{payload.data.issue.shortId}}`, `{{payload.data.issue.title}}`, `{{payload.data.issue.web_url}}`, `{{payload.data.issue.project.slug}}`, `{{payload.data.issue.status}}`, `{{payload.data.issue.substatus}}`, `{{payload.data.issue.issueCategory}}`, `{{payload.data.issue.issueType}}`, `{{payload.actor}}`
- `sentry.issue.resolved`: Issue resolved
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data.issue}}`, `{{payload.data.issue.id}}`, `{{payload.data.issue.shortId}}`, `{{payload.data.issue.title}}`, `{{payload.data.issue.web_url}}`, `{{payload.data.issue.project.slug}}`, `{{payload.data.issue.status}}`, `{{payload.data.issue.substatus}}`, `{{payload.data.issue.issueCategory}}`, `{{payload.data.issue.issueType}}`, `{{payload.actor}}`
- `sentry.issue.assigned`: Issue assigned
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data.issue}}`, `{{payload.data.issue.id}}`, `{{payload.data.issue.shortId}}`, `{{payload.data.issue.title}}`, `{{payload.data.issue.web_url}}`, `{{payload.data.issue.project.slug}}`, `{{payload.data.issue.status}}`, `{{payload.data.issue.substatus}}`, `{{payload.data.issue.issueCategory}}`, `{{payload.data.issue.issueType}}`, `{{payload.actor}}`
- `sentry.issue.archived`: Issue archived
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data.issue}}`, `{{payload.data.issue.id}}`, `{{payload.data.issue.shortId}}`, `{{payload.data.issue.title}}`, `{{payload.data.issue.web_url}}`, `{{payload.data.issue.project.slug}}`, `{{payload.data.issue.status}}`, `{{payload.data.issue.substatus}}`, `{{payload.data.issue.issueCategory}}`, `{{payload.data.issue.issueType}}`, `{{payload.actor}}`
- `sentry.issue.unresolved`: Issue unresolved
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data.issue}}`, `{{payload.data.issue.id}}`, `{{payload.data.issue.shortId}}`, `{{payload.data.issue.title}}`, `{{payload.data.issue.web_url}}`, `{{payload.data.issue.project.slug}}`, `{{payload.data.issue.status}}`, `{{payload.data.issue.substatus}}`, `{{payload.data.issue.issueCategory}}`, `{{payload.data.issue.issueType}}`, `{{payload.actor}}`

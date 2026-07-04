# Linear

Provider family ID: `linear`
Integration target key: `linear-default`
Variant ID: `linear-default`
Binding kind: `connector`
Description: Enable access to Linear issues, projects, and workflows from agents.

Setup methods:

- `api-key` (form): API key
- `linear-oauth-app` (form): Linear OAuth app

Binding tools:

- `linear-mcp`: Linear MCP

Trigger events:

- `linear.issue.created`: Issue created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.data.identifier}}`, `{{payload.data.teamId}}`, `{{payload.data.assigneeId}}`, `{{payload.mistle.changedFields}}`, `{{payload.mistle.assignment}}`
- `linear.issue.updated`: Issue updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.data.identifier}}`, `{{payload.data.teamId}}`, `{{payload.data.assigneeId}}`, `{{payload.mistle.changedFields}}`, `{{payload.mistle.assignment}}`
- `linear.issue.removed`: Issue removed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.data.identifier}}`, `{{payload.data.teamId}}`, `{{payload.data.assigneeId}}`, `{{payload.mistle.changedFields}}`, `{{payload.mistle.assignment}}`
- `linear.comment.created`: Comment created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.data.issueId}}`, `{{payload.data.userId}}`, `{{payload.data.body}}`
- `linear.comment.updated`: Comment updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.data.issueId}}`, `{{payload.data.userId}}`, `{{payload.data.body}}`
- `linear.comment.removed`: Comment removed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.data.issueId}}`, `{{payload.data.userId}}`, `{{payload.data.body}}`
- `linear.issue_label.created`: Issue label created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.mistle.changedFields}}`
- `linear.issue_label.updated`: Issue label updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.mistle.changedFields}}`
- `linear.issue_label.removed`: Issue label removed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.mistle.changedFields}}`
- `linear.project.created`: Project created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.mistle.changedFields}}`
- `linear.project.updated`: Project updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.mistle.changedFields}}`
- `linear.project.removed`: Project removed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.mistle.changedFields}}`
- `linear.cycle.created`: Cycle created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.mistle.changedFields}}`
- `linear.cycle.updated`: Cycle updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.mistle.changedFields}}`
- `linear.cycle.removed`: Cycle removed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.mistle.changedFields}}`
- `linear.reaction.created`: Reaction created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.mistle.changedFields}}`
- `linear.reaction.updated`: Reaction updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.mistle.changedFields}}`
- `linear.reaction.removed`: Reaction removed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.mistle.changedFields}}`

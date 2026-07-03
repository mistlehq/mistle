<!-- Generated from the Mistle integration registry. Do not edit by hand. Run pnpm --filter @mistle/control-plane-api designer:integration-catalog:generate. -->

# Slack

Provider family ID: `slack`
Integration target key: `slack-default`
Variant ID: `slack-default`
Binding kind: `connector`
Description: Enable access to Slack Web API endpoints and Slack Events API callbacks.

Setup methods:

- `slack-bot-token` (form): Slack app

Resource kinds:

- `workspace`: workspaces (single)
- `channel`: channels (multi)
- `user`: users (multi)
- `user_group`: user groups (multi)

Binding tools:

- `slack-cli`: Slack CLI (default)
- `slack-mcp`: Slack MCP

Trigger events:

- `slack:message`: Message
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.event.channel}}`, `{{payload.event.ts}}`, `{{payload.event.thread_ts}}`, `{{payload.event.mistle_thread_root_ts}}`, `{{payload.event.user}}`, `{{payload.event.text}}`
- `slack:app_mention`: App mention
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.event.channel}}`, `{{payload.event.ts}}`, `{{payload.event.thread_ts}}`, `{{payload.event.mistle_thread_root_ts}}`, `{{payload.event.user}}`, `{{payload.event.text}}`
- `slack:reaction_added`: Reaction added
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.event.channel}}`, `{{payload.event.item.channel}}`, `{{payload.event.item.ts}}`, `{{payload.event.mistle_thread_root_ts}}`, `{{payload.event.user}}`, `{{payload.event.reaction}}`
- `slack:reaction_removed`: Reaction removed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.event.channel}}`, `{{payload.event.item.channel}}`, `{{payload.event.item.ts}}`, `{{payload.event.mistle_thread_root_ts}}`, `{{payload.event.user}}`, `{{payload.event.reaction}}`

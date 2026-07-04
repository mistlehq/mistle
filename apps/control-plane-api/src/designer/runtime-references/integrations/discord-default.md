# Discord

Provider family ID: `discord`
Integration target key: `discord-default`
Variant ID: `discord-default`
Binding kind: `connector`
Description: Enable access to Discord REST API operations, local Discord MCP tools, and signed Discord HTTP callbacks.

Setup methods:

- `discord-bot` (form): Discord bot

Resource kinds:

- `guild`: guilds (multi)
- `channel`: channels (multi)

Binding tools:

- `discord-cli`: Discord CLI
- `discord-mcp`: Discord MCP

Trigger events:

- `discord:application_authorized`: Application authorized
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.id}}`, `{{payload.type}}`, `{{payload.application_id}}`, `{{payload.guild_id}}`, `{{payload.channel_id}}`, `{{payload.data}}`
- `discord:application_deauthorized`: Application deauthorized
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.id}}`, `{{payload.type}}`, `{{payload.application_id}}`, `{{payload.guild_id}}`, `{{payload.channel_id}}`, `{{payload.data}}`
- `discord:entitlement_create`: Entitlement created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.id}}`, `{{payload.type}}`, `{{payload.application_id}}`, `{{payload.guild_id}}`, `{{payload.channel_id}}`, `{{payload.data}}`
- `discord:entitlement_update`: Entitlement updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.id}}`, `{{payload.type}}`, `{{payload.application_id}}`, `{{payload.guild_id}}`, `{{payload.channel_id}}`, `{{payload.data}}`
- `discord:entitlement_delete`: Entitlement deleted
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.id}}`, `{{payload.type}}`, `{{payload.application_id}}`, `{{payload.guild_id}}`, `{{payload.channel_id}}`, `{{payload.data}}`
- `discord:message_create`: Message created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.t}}`, `{{payload.s}}`, `{{payload.d}}`, `{{payload.d.guild_id}}`, `{{payload.d.channel_id}}`
- `discord:message_update`: Message updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.t}}`, `{{payload.s}}`, `{{payload.d}}`, `{{payload.d.guild_id}}`, `{{payload.d.channel_id}}`
- `discord:message_delete`: Message deleted
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.t}}`, `{{payload.s}}`, `{{payload.d}}`, `{{payload.d.guild_id}}`, `{{payload.d.channel_id}}`
- `discord:message_reaction_add`: Reaction added
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.t}}`, `{{payload.s}}`, `{{payload.d}}`, `{{payload.d.guild_id}}`, `{{payload.d.channel_id}}`
- `discord:message_reaction_remove`: Reaction removed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.t}}`, `{{payload.s}}`, `{{payload.d}}`, `{{payload.d.guild_id}}`, `{{payload.d.channel_id}}`

<!-- Generated from the Mistle integration registry. Do not edit by hand. Run pnpm --filter @mistle/control-plane-api designer:integration-catalog:generate. -->

# Whapi

Provider family ID: `whapi`
Integration target key: `whapi-mcp`
Variant ID: `whapi-mcp`
Binding kind: `connector`
Description: Enable Whapi MCP access and webhook triggers for WhatsApp channels.

Setup methods:

- `api-key` (form): API token

Binding tools:

- `whapi-mcp`: Whapi MCP (default)

Trigger events:

- `whapi.messages.post`: Message created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.messages}}`, `{{payload.messages["0"].id}}`, `{{payload.messages["0"].chat_id}}`, `{{payload.messages["0"].from}}`, `{{payload.messages["0"].text.body}}`
- `whapi.messages.put`: Message updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.messages}}`, `{{payload.messages["0"].id}}`, `{{payload.messages["0"].chat_id}}`, `{{payload.messages["0"].from}}`, `{{payload.messages["0"].text.body}}`
- `whapi.messages.delete`: Message deleted
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.messages}}`, `{{payload.messages["0"].id}}`, `{{payload.messages["0"].chat_id}}`, `{{payload.messages["0"].from}}`, `{{payload.messages["0"].text.body}}`
- `whapi.messages.patch`: Message patched
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.messages}}`, `{{payload.messages["0"].id}}`, `{{payload.messages["0"].chat_id}}`, `{{payload.messages["0"].from}}`, `{{payload.messages["0"].text.body}}`
- `whapi.statuses.post`: Status created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.statuses}}`, `{{payload.statuses["0"].id}}`, `{{payload.statuses["0"].status}}`, `{{payload.statuses["0"].recipient_id}}`
- `whapi.statuses.put`: Status updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.statuses}}`, `{{payload.statuses["0"].id}}`, `{{payload.statuses["0"].status}}`, `{{payload.statuses["0"].recipient_id}}`
- `whapi.chats.post`: Chat created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.chats}}`, `{{payload.chats["0"].id}}`, `{{payload.chats["0"].name}}`, `{{payload.changes}}`
- `whapi.chats.put`: Chat updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.chats}}`, `{{payload.chats["0"].id}}`, `{{payload.chats["0"].name}}`, `{{payload.changes}}`
- `whapi.chats.delete`: Chat deleted
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.chats}}`, `{{payload.chats["0"].id}}`, `{{payload.chats["0"].name}}`, `{{payload.changes}}`
- `whapi.chats.patch`: Chat patched
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.chats}}`, `{{payload.chats["0"].id}}`, `{{payload.chats["0"].name}}`, `{{payload.changes}}`
- `whapi.contacts.post`: Contact created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.contacts}}`, `{{payload.contacts["0"].id}}`, `{{payload.changes}}`
- `whapi.contacts.patch`: Contact patched
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.contacts}}`, `{{payload.contacts["0"].id}}`, `{{payload.changes}}`
- `whapi.groups.post`: Group created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.groups}}`, `{{payload.groups["0"].id}}`, `{{payload.changes}}`
- `whapi.groups.put`: Group updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.groups}}`, `{{payload.groups["0"].id}}`, `{{payload.changes}}`
- `whapi.groups.patch`: Group patched
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.groups}}`, `{{payload.groups["0"].id}}`, `{{payload.changes}}`
- `whapi.presences.post`: Presence changed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.presences}}`, `{{payload.presences["0"].id}}`
- `whapi.channel.post`: Channel status changed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.status}}`
- `whapi.channel.patch`: Channel patched
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.status}}`
- `whapi.users.post`: User connected
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.user.id}}`, `{{payload.user.name}}`
- `whapi.users.delete`: User disconnected
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.user.id}}`, `{{payload.user.name}}`
- `whapi.labels.post`: Label created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.labels}}`, `{{payload.labels["0"].id}}`, `{{payload.labels["0"].name}}`
- `whapi.labels.delete`: Label deleted
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.labels}}`, `{{payload.labels["0"].id}}`, `{{payload.labels["0"].name}}`
- `whapi.calls.post`: Call received
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event.type}}`, `{{payload.event.event}}`, `{{payload.channel_id}}`, `{{payload.calls}}`, `{{payload.calls["0"].id}}`, `{{payload.calls["0"].from}}`

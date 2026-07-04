# WasenderAPI

Provider family ID: `wasenderapi`
Integration target key: `wasenderapi-mcp`
Variant ID: `wasenderapi-mcp`
Binding kind: `connector`
Description: Enable WasenderAPI hosted MCP access for WhatsApp sessions.

Setup methods:

- `api-key` (form): Personal access token

Binding tools:

- `wasenderapi-mcp`: WasenderAPI MCP (default)

Trigger events:

- `wasenderapi.messages.received`: Message received
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.messages}}`, `{{payload.data.messages.key.id}}`, `{{payload.data.messages["0"].key.id}}`, `{{payload.data.messages.key.remoteJid}}`, `{{payload.data.messages["0"].key.remoteJid}}`, `{{payload.data.messages.messageBody}}`, `{{payload.data.messages["0"].messageBody}}`
- `wasenderapi.messages.upsert`: Message upsert
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.messages}}`, `{{payload.data.messages.key.id}}`, `{{payload.data.messages["0"].key.id}}`, `{{payload.data.messages.key.remoteJid}}`, `{{payload.data.messages["0"].key.remoteJid}}`, `{{payload.data.messages.messageBody}}`, `{{payload.data.messages["0"].messageBody}}`
- `wasenderapi.messages-personal.received`: Personal message received
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.messages}}`, `{{payload.data.messages.key.id}}`, `{{payload.data.messages["0"].key.id}}`, `{{payload.data.messages.key.remoteJid}}`, `{{payload.data.messages["0"].key.remoteJid}}`, `{{payload.data.messages.messageBody}}`, `{{payload.data.messages["0"].messageBody}}`
- `wasenderapi.messages-group.received`: Group message received
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.messages}}`, `{{payload.data.messages.key.id}}`, `{{payload.data.messages["0"].key.id}}`, `{{payload.data.messages.key.remoteJid}}`, `{{payload.data.messages["0"].key.remoteJid}}`, `{{payload.data.messages.messageBody}}`, `{{payload.data.messages["0"].messageBody}}`
- `wasenderapi.messages-newsletter.received`: Newsletter message received
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.messages}}`, `{{payload.data.messages.key.id}}`, `{{payload.data.messages["0"].key.id}}`, `{{payload.data.messages.key.remoteJid}}`, `{{payload.data.messages["0"].key.remoteJid}}`, `{{payload.data.messages.messageBody}}`, `{{payload.data.messages["0"].messageBody}}`
- `wasenderapi.message.sent`: Message sent
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.key.id}}`, `{{payload.data.key.remoteJid}}`, `{{payload.data.message}}`
- `wasenderapi.messages.update`: Message status update
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.key.id}}`, `{{payload.data.key.remoteJid}}`, `{{payload.data.message}}`
- `wasenderapi.messages.delete`: Message deleted
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.keys}}`, `{{payload.data.keys["0"].id}}`, `{{payload.data.keys["0"].remoteJid}}`
- `wasenderapi.message-receipt.update`: Message receipt update
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.message.key.id}}`, `{{payload.data.message.key.remoteJid}}`, `{{payload.data.message.receipt}}`
- `wasenderapi.messages.reaction`: Message reaction
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data["0"].key.id}}`, `{{payload.data["0"].key.remoteJid}}`, `{{payload.data["0"].reaction}}`
- `wasenderapi.call`: Call received
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.id}}`, `{{payload.data.from}}`
- `wasenderapi.session.status`: Session status
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.status}}`, `{{payload.data.qr}}`
- `wasenderapi.qrcode.updated`: QR code updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.status}}`, `{{payload.data.qr}}`
- `wasenderapi.chats.upsert`: Chat upsert
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data["0"].id}}`
- `wasenderapi.chats.update`: Chat update
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data["0"].id}}`
- `wasenderapi.chats.delete`: Chat deleted
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data["0"].id}}`
- `wasenderapi.groups.upsert`: Group upsert
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data["0"].jid}}`
- `wasenderapi.groups.update`: Group update
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data["0"].jid}}`
- `wasenderapi.group-participants.update`: Group participants update
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.jid}}`, `{{payload.data.participants}}`, `{{payload.data.action}}`
- `wasenderapi.contacts.upsert`: Contact upsert
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data["0"].jid}}`
- `wasenderapi.contacts.update`: Contact update
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data["0"].jid}}`
- `wasenderapi.poll.results`: Poll results
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.event}}`, `{{payload.timestamp}}`, `{{payload.sessionId}}`, `{{payload.data}}`, `{{payload.data.key.id}}`, `{{payload.data.key.remoteJid}}`, `{{payload.data.pollResult}}`

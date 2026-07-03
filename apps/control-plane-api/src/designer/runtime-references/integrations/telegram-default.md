# Telegram

Provider family ID: `telegram`
Integration target key: `telegram-default`
Variant ID: `telegram-default`
Binding kind: `connector`
Description: Enable access to Telegram Bot API operations and local Telegram MCP tools.

Setup methods:

- `telegram-bot` (form): Telegram bot

Binding tools:

- `telegram-cli`: Telegram CLI
- `telegram-mcp`: Telegram MCP

Trigger events:

- `telegram.message`: Message
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.message}}`
- `telegram.edited_message`: Edited message
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.edited_message}}`
- `telegram.channel_post`: Channel post
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.channel_post}}`
- `telegram.edited_channel_post`: Edited channel post
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.edited_channel_post}}`
- `telegram.business_connection`: Business connection
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.business_connection}}`
- `telegram.business_message`: Business message
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.business_message}}`
- `telegram.guest_message`: Guest message
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.guest_message}}`
- `telegram.edited_business_message`: Edited business message
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.edited_business_message}}`
- `telegram.deleted_business_messages`: Deleted business messages
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.deleted_business_messages}}`
- `telegram.message_reaction`: Message reaction
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.message_reaction}}`
- `telegram.message_reaction_count`: Message reaction count
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.message_reaction_count}}`
- `telegram.inline_query`: Inline query
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.inline_query}}`
- `telegram.chosen_inline_result`: Chosen inline result
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.chosen_inline_result}}`
- `telegram.callback_query`: Callback query
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.callback_query}}`
- `telegram.shipping_query`: Shipping query
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.shipping_query}}`
- `telegram.pre_checkout_query`: Pre-checkout query
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.pre_checkout_query}}`
- `telegram.purchased_paid_media`: Purchased paid media
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.purchased_paid_media}}`
- `telegram.poll`: Poll
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.poll}}`
- `telegram.poll_answer`: Poll answer
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.poll_answer}}`
- `telegram.my_chat_member`: Bot chat member status
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.my_chat_member}}`
- `telegram.chat_member`: Chat member status
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.chat_member}}`
- `telegram.chat_join_request`: Chat join request
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.chat_join_request}}`
- `telegram.chat_boost`: Chat boost
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.chat_boost}}`
- `telegram.removed_chat_boost`: Removed chat boost
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.removed_chat_boost}}`
- `telegram.managed_bot`: Managed bot
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.update_id}}`, `{{payload.managed_bot}}`

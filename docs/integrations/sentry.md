# Sentry Integration

The Sentry integration lets agents use Sentry's hosted MCP server and lets Mistle triggers respond to Sentry issue webhooks.

## MCP Connection Setup

Use the **Sentry MCP OAuth** connection method to authorize hosted Sentry MCP access.

After the connection is saved, select **Sentry MCP** in the integration binding for the agents that should use Sentry tools.

## Webhook Connection Setup

Use the **Sentry webhooks** connection method with a Sentry Internal Integration. Sentry's integration platform requires a webhook URL when configuring an integration; Mistle exposes that URL after the webhook connection is saved.

In Sentry:

1. Create an Internal Integration for the Sentry organization.
2. In **Internal Integration Details**, leave **Webhook URL** blank until the Mistle connection has been saved.
3. Enable issue webhooks for the integration.
4. Copy the integration client secret.

In Mistle:

1. Create a Sentry connection with the **Sentry webhooks** method.
2. Paste the Sentry Internal Integration client secret.
3. Save the connection.
4. Copy the **Webhook callback URL** from the connection detail page.

Return to Sentry and paste the Mistle **Webhook callback URL** into the Internal Integration **Webhook URL** field.

The webhook callback URL is available after the Mistle connection is saved because Mistle creates the webhook source for the connection at that point.

Sentry's webhook and issue-event behavior is documented in the Sentry integration platform docs:

- [Sentry webhooks](https://docs.sentry.io/integrations/integration-platform/webhooks/)
- [Sentry issue webhooks](https://docs.sentry.io/integrations/integration-platform/webhooks/issues/)

## Supported Webhook Events

Mistle supports Sentry issue webhook events for triggers:

- `sentry.issue.created`
- `sentry.issue.resolved`
- `sentry.issue.assigned`
- `sentry.issue.archived`
- `sentry.issue.unresolved`

Trigger messages and instructions can reference fields from the Sentry webhook payload.

## Limitations

- Sentry webhook support is limited to issue events.
- The webhook connection verifies Sentry webhook signatures with the Internal Integration client secret. Mistle does not register the webhook URL in Sentry automatically.

# Discord Integration

The Discord integration lets agents use Discord REST operations and Discord MCP tools without storing the bot token inside the sandbox as a raw credential. Mistle stores the bot token, applies `Authorization: Bot <token>` through managed egress, and verifies signed Discord callbacks before creating trigger events.

## Connection Setup

Use the **Discord bot** connection method.

In the Discord Developer Portal:

1. Create or open a Discord application.
2. Add a bot to the application.
3. Install the bot into the guilds where agents should operate.
4. Copy the application public key.
5. Copy the bot token.
6. Save the public key and bot token in Mistle.
7. Copy the Mistle callback URL into the application's **Interactions Endpoint URL** field.

In Mistle:

- **Bot token** is the raw Discord bot token. Do not include the `Bot ` prefix.
- **Public key** is the hex-encoded Discord application public key used to verify signed callbacks.
- **Application ID** is optional setup context for the Discord application.

Discord validates the Interactions Endpoint URL by sending a signed ping. Save the public key in Mistle before configuring the endpoint URL so Mistle can verify the Ed25519 signature and return Discord's pong response.

## Binding Setup

Discord bindings control which sandbox tools are available.

- **Discord CLI** installs the `discord` command from `mistlehq/tools`.
- **Discord MCP** starts the local Discord MCP server and exposes its tools to the selected agent runtime.

The binding also creates a managed egress route for `https://discord.com/api/v10`. Agents and local tools send ordinary Discord API requests through that route; Mistle resolves the saved bot token and injects the required `Authorization: Bot <token>` header.

## Supported Tooling

The Discord tool supports:

- auth test
- guild list/get
- channel list/get
- message list/send/edit/delete
- reaction add/remove
- role list/create/delete
- member list/get/add-role/remove-role/ban/unban
- Discord MCP equivalents for agent tool use

Actual access still depends on the permissions granted to the Discord bot in each guild and channel.

## Webhook Triggers

Mistle supports Discord HTTP callbacks for:

- application authorized/deauthorized events
- entitlement create/update/delete events

These payloads are verified using Discord's Ed25519 signature headers and the saved application public key.
Mistle acknowledges non-ping interaction callbacks with Discord's deferred channel message response, but interaction callbacks are not exposed as Mistle triggers in this release.

## Gateway Triggers

Ordinary channel-message and reaction events come from Discord Gateway, not from the Interactions Endpoint URL. Mistle supports these Gateway dispatch events when a relay posts signed dispatch payloads to the Mistle callback URL:

- `MESSAGE_CREATE`
- `MESSAGE_UPDATE`
- `MESSAGE_DELETE`
- `MESSAGE_REACTION_ADD`
- `MESSAGE_REACTION_REMOVE`

The relay must send the raw Discord Gateway dispatch envelope, for example:

```json
{
  "op": 0,
  "s": 42,
  "t": "MESSAGE_CREATE",
  "d": {
    "id": "message-id",
    "channel_id": "channel-id",
    "guild_id": "guild-id",
    "content": "message text"
  }
}
```

The relay signs the request with HMAC-SHA256 over `timestamp + raw_body`, using the saved Discord bot token as the HMAC key. It must include:

```text
x-mistle-discord-gateway-timestamp: <unix timestamp or stable timestamp string>
x-mistle-discord-gateway-signature: <hex hmac-sha256>
```

Enable the Discord Gateway intents needed for the selected events. Message text filters require the privileged **Message Content Intent**.

## Resource Discovery

Mistle can discover:

- guilds visible to the bot
- guild channels visible to the bot

These resources can be used by trigger filters and binding configuration where applicable.

## Limitations

- Mistle does not host a long-running Discord Gateway socket process in this integration definition. Gateway triggers require an external relay that connects to Discord Gateway and posts signed dispatch payloads to the Mistle callback URL.
- No Discord OAuth user-token flow is included.
- Mistle does not grant Discord permissions. The bot must already have the required guild, channel, role, member, and intent access in Discord.

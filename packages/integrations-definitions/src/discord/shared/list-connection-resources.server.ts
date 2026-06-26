import { buildUrlWithPath } from "@mistle/http";
import type {
  DiscoveredIntegrationResource,
  ListConnectionResourcesInput,
  ListConnectionResourcesResult,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  DiscordConnectionConfigSchema,
  type DiscordConnectionConfig,
} from "../variants/discord-default/auth.js";
import type { DiscordTargetConfig } from "../variants/discord-default/target-config-schema.js";

const DiscordGuildKind = "guild";
const DiscordChannelKind = "channel";

const DiscordGuildSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().optional().nullable(),
  owner: z.boolean().optional(),
  permissions: z.string().optional(),
});

const DiscordChannelSchema = z.looseObject({
  id: z.string().min(1),
  type: z.number(),
  guild_id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  position: z.number().optional(),
  parent_id: z.string().optional().nullable(),
  topic: z.string().optional().nullable(),
});

type DiscordGuild = z.output<typeof DiscordGuildSchema>;
type DiscordChannel = z.output<typeof DiscordChannelSchema>;

type DiscordListConnectionResourcesInput = ListConnectionResourcesInput<
  DiscordTargetConfig,
  Record<string, never>,
  DiscordConnectionConfig
>;

function buildDiscordGuildsListUrl(input: { apiBaseUrl: string }): URL {
  return new URL(buildUrlWithPath(input.apiBaseUrl, "/users/@me/guilds"));
}

function buildDiscordGuildChannelsListUrl(input: { apiBaseUrl: string; guildId: string }): URL {
  return new URL(buildUrlWithPath(input.apiBaseUrl, `/guilds/${input.guildId}/channels`));
}

function toDiscoveredGuildResource(guild: DiscordGuild): DiscoveredIntegrationResource {
  return {
    externalId: guild.id,
    handle: guild.id,
    displayName: guild.name,
    metadata: {
      ...(guild.icon === undefined || guild.icon === null ? {} : { icon: guild.icon }),
      ...(guild.owner === undefined ? {} : { owner: guild.owner }),
      ...(guild.permissions === undefined ? {} : { permissions: guild.permissions }),
    },
  };
}

function toDiscoveredChannelResource(channel: DiscordChannel): DiscoveredIntegrationResource {
  const displayName = channel.name === undefined ? channel.id : `#${channel.name}`;

  return {
    externalId: channel.id,
    handle: channel.id,
    displayName,
    metadata: {
      type: channel.type,
      ...(channel.guild_id === undefined ? {} : { guildId: channel.guild_id }),
      ...(channel.name === undefined ? {} : { name: channel.name }),
      ...(channel.position === undefined ? {} : { position: channel.position }),
      ...(channel.parent_id === undefined || channel.parent_id === null
        ? {}
        : { parentId: channel.parent_id }),
      ...(channel.topic === undefined || channel.topic === null ? {} : { topic: channel.topic }),
    },
  };
}

async function listDiscordGuilds(input: {
  apiBaseUrl: string;
  botToken: string;
}): Promise<ReadonlyArray<DiscoveredIntegrationResource>> {
  const response = await fetch(buildDiscordGuildsListUrl({ apiBaseUrl: input.apiBaseUrl }), {
    method: "GET",
    headers: {
      authorization: `Bot ${input.botToken}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Discord guild list request failed with status ${String(response.status)}.`);
  }

  const guilds = z.array(DiscordGuildSchema).parse(await response.json());
  return guilds
    .map((guild) => toDiscoveredGuildResource(guild))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

async function listDiscordChannels(input: {
  apiBaseUrl: string;
  botToken: string;
}): Promise<ReadonlyArray<DiscoveredIntegrationResource>> {
  const guilds = await listDiscordGuilds(input);
  const channels: DiscoveredIntegrationResource[] = [];

  for (const guild of guilds) {
    const guildId = guild.externalId;
    if (guildId === undefined) {
      throw new Error("Discovered Discord guild resource is missing externalId.");
    }

    const response = await fetch(
      buildDiscordGuildChannelsListUrl({
        apiBaseUrl: input.apiBaseUrl,
        guildId,
      }),
      {
        method: "GET",
        headers: {
          authorization: `Bot ${input.botToken}`,
          accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Discord channel list request for guild '${guildId}' failed with status ${String(response.status)}.`,
      );
    }

    const parsedChannels = z.array(DiscordChannelSchema).parse(await response.json());
    channels.push(
      ...parsedChannels.map((channel) =>
        toDiscoveredChannelResource({
          ...channel,
          guild_id: channel.guild_id ?? guildId,
        }),
      ),
    );
  }

  return channels.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export async function listDiscordConnectionResources(
  input: DiscordListConnectionResourcesInput,
): Promise<ListConnectionResourcesResult> {
  if (input.credential === undefined) {
    throw new Error(`Discord ${input.kind} resource listing requires a resolved credential.`);
  }

  if (input.credential.kind !== "value") {
    throw new Error(`Discord ${input.kind} resource listing requires a string credential value.`);
  }

  DiscordConnectionConfigSchema.parse(input.connection.config);

  if (input.kind === DiscordGuildKind) {
    return {
      resources: await listDiscordGuilds({
        apiBaseUrl: input.target.config.apiBaseUrl,
        botToken: input.credential.value,
      }),
    };
  }

  if (input.kind === DiscordChannelKind) {
    return {
      resources: await listDiscordChannels({
        apiBaseUrl: input.target.config.apiBaseUrl,
        botToken: input.credential.value,
      }),
    };
  }

  throw new Error(`Unsupported Discord resource kind '${input.kind}'.`);
}

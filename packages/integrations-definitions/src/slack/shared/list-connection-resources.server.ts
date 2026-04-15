import type {
  DiscoveredIntegrationResource,
  ListConnectionResourcesInput,
  ListConnectionResourcesResult,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  SlackBotTokenConnectionConfigSchema,
  type SlackConnectionConfig,
} from "../variants/slack-default/auth.js";
import type { SlackTargetConfig } from "../variants/slack-default/target-config-schema.js";
import type { SlackTargetSecrets } from "../variants/slack-default/target-secret-schema.js";

const SlackChannelKind = "channel";

const SlackConversationSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  is_channel: z.boolean().optional(),
  is_group: z.boolean().optional(),
  is_private: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  is_shared: z.boolean().optional(),
  is_ext_shared: z.boolean().optional(),
  is_im: z.boolean().optional(),
  is_mpim: z.boolean().optional(),
});

const SlackConversationsListResponseSchema = z.looseObject({
  ok: z.boolean(),
  channels: z.array(SlackConversationSchema).optional(),
  error: z.string().min(1).optional(),
  response_metadata: z
    .looseObject({
      next_cursor: z.string().optional(),
    })
    .optional(),
});

type SlackListConnectionResourcesInput = ListConnectionResourcesInput<
  SlackTargetConfig,
  SlackTargetSecrets,
  SlackConnectionConfig
>;

type SlackConversation = z.output<typeof SlackConversationSchema>;

function buildSlackConversationsListUrl(input: { apiBaseUrl: string; cursor?: string }): URL {
  const apiUrl = new URL(input.apiBaseUrl);
  apiUrl.pathname = `${apiUrl.pathname === "/" ? "" : apiUrl.pathname}/conversations.list`;
  apiUrl.searchParams.set("types", "public_channel,private_channel");
  apiUrl.searchParams.set("exclude_archived", "true");
  if (input.cursor !== undefined && input.cursor.length > 0) {
    apiUrl.searchParams.set("cursor", input.cursor);
  }
  return apiUrl;
}

function isSelectableChannel(conversation: SlackConversation): boolean {
  return (
    (conversation.is_channel === true || conversation.is_group === true) &&
    conversation.is_archived !== true &&
    conversation.is_im !== true &&
    conversation.is_mpim !== true
  );
}

function toDiscoveredChannelResource(
  conversation: SlackConversation,
): DiscoveredIntegrationResource {
  const name = conversation.name?.trim() ?? "";

  return {
    externalId: conversation.id,
    handle: conversation.id,
    displayName: name.length === 0 ? conversation.id : `#${name}`,
    metadata: {
      ...(name.length === 0 ? {} : { name }),
      isPrivate: conversation.is_private ?? false,
      isArchived: conversation.is_archived ?? false,
      isShared: conversation.is_shared ?? false,
      isExtShared: conversation.is_ext_shared ?? false,
      isIm: conversation.is_im ?? false,
      isMpim: conversation.is_mpim ?? false,
      isChannel: conversation.is_channel ?? false,
      isGroup: conversation.is_group ?? false,
    },
  };
}

async function listSlackChannels(input: {
  apiBaseUrl: string;
  botToken: string;
}): Promise<ReadonlyArray<DiscoveredIntegrationResource>> {
  const channels: DiscoveredIntegrationResource[] = [];
  let nextCursor: string | undefined;

  for (;;) {
    const response = await fetch(
      buildSlackConversationsListUrl({
        apiBaseUrl: input.apiBaseUrl,
        ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
      }),
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${input.botToken}`,
          accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Slack conversations.list request failed with status ${String(response.status)}.`,
      );
    }

    const parsedPayload = SlackConversationsListResponseSchema.parse(await response.json());
    if (!parsedPayload.ok) {
      throw new Error(
        `Slack conversations.list returned an error${parsedPayload.error === undefined ? "." : `: ${parsedPayload.error}.`}`,
      );
    }

    for (const conversation of parsedPayload.channels ?? []) {
      if (!isSelectableChannel(conversation)) {
        continue;
      }

      channels.push(toDiscoveredChannelResource(conversation));
    }

    const candidateCursor = parsedPayload.response_metadata?.next_cursor?.trim() ?? "";
    if (candidateCursor.length === 0) {
      break;
    }

    nextCursor = candidateCursor;
  }

  return channels.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export async function listSlackConnectionResources(
  input: SlackListConnectionResourcesInput,
): Promise<ListConnectionResourcesResult> {
  if (input.credential === undefined) {
    throw new Error(`Slack ${input.kind} resource listing requires a resolved credential.`);
  }

  if (input.credential.kind !== "value") {
    throw new Error(`Slack ${input.kind} resource listing requires a string credential value.`);
  }

  SlackBotTokenConnectionConfigSchema.parse(input.connection.config);

  if (input.kind === SlackChannelKind) {
    return {
      resources: await listSlackChannels({
        apiBaseUrl: input.target.config.apiBaseUrl,
        botToken: input.credential.value,
      }),
    };
  }

  throw new Error(`Unsupported Slack resource kind '${input.kind}'.`);
}

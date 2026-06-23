import { buildUrlWithPath } from "@mistle/http";
import type {
  DiscoveredIntegrationResource,
  ListConnectionResourcesInput,
  ListConnectionResourcesResult,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  SlackConnectionConfigSchema,
  type SlackConnectionConfig,
} from "../variants/slack-default/auth.js";
import type { SlackTargetConfig } from "../variants/slack-default/target-config-schema.js";
import type { SlackTargetSecrets } from "../variants/slack-default/target-secret-schema.js";

const SlackChannelKind = "channel";
const SlackUserKind = "user";
const SlackUserGroupKind = "user_group";

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

const SlackUserProfileSchema = z.looseObject({
  display_name: z.string().optional(),
  real_name: z.string().optional(),
  image_48: z.string().optional(),
});

const SlackUserSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  real_name: z.string().optional(),
  deleted: z.boolean().optional(),
  is_bot: z.boolean().optional(),
  is_app_user: z.boolean().optional(),
  is_workflow_bot: z.boolean().optional(),
  team_id: z.string().optional(),
  tz: z.string().optional(),
  profile: SlackUserProfileSchema.optional(),
});

const SlackUsersListResponseSchema = z.looseObject({
  ok: z.boolean(),
  members: z.array(SlackUserSchema).optional(),
  error: z.string().min(1).optional(),
  response_metadata: z
    .looseObject({
      next_cursor: z.string().optional(),
    })
    .optional(),
});

const SlackUserGroupSchema = z.looseObject({
  id: z.string().min(1),
  team_id: z.string().optional(),
  name: z.string().min(1).optional(),
  handle: z.string().min(1).optional(),
  description: z.string().optional(),
  is_usergroup: z.boolean().optional(),
  is_external: z.boolean().optional(),
  date_delete: z.number().optional(),
  user_count: z.union([z.string(), z.number()]).optional(),
});

const SlackUserGroupsListResponseSchema = z.looseObject({
  ok: z.boolean(),
  usergroups: z.array(SlackUserGroupSchema).optional(),
  error: z.string().min(1).optional(),
});

type SlackListConnectionResourcesInput = ListConnectionResourcesInput<
  SlackTargetConfig,
  SlackTargetSecrets,
  SlackConnectionConfig
>;

type SlackConversation = z.output<typeof SlackConversationSchema>;
type SlackUser = z.output<typeof SlackUserSchema>;
type SlackUserGroup = z.output<typeof SlackUserGroupSchema>;

function buildSlackConversationsListUrl(input: { apiBaseUrl: string; cursor?: string }): URL {
  const apiUrl = new URL(buildUrlWithPath(input.apiBaseUrl, "/conversations.list"));
  apiUrl.searchParams.set("types", "public_channel,private_channel");
  apiUrl.searchParams.set("exclude_archived", "true");
  if (input.cursor !== undefined && input.cursor.length > 0) {
    apiUrl.searchParams.set("cursor", input.cursor);
  }
  return apiUrl;
}

function buildSlackUsersListUrl(input: { apiBaseUrl: string; cursor?: string }): URL {
  const apiUrl = new URL(buildUrlWithPath(input.apiBaseUrl, "/users.list"));
  if (input.cursor !== undefined && input.cursor.length > 0) {
    apiUrl.searchParams.set("cursor", input.cursor);
  }
  return apiUrl;
}

function buildSlackUserGroupsListUrl(input: { apiBaseUrl: string }): URL {
  const apiUrl = new URL(buildUrlWithPath(input.apiBaseUrl, "/usergroups.list"));
  apiUrl.searchParams.set("include_disabled", "false");
  apiUrl.searchParams.set("include_users", "false");
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

function resolveSlackUserDisplayName(user: SlackUser): string {
  const profileDisplayName = user.profile?.display_name?.trim() ?? "";
  if (profileDisplayName.length > 0) {
    return profileDisplayName;
  }

  const profileRealName = user.profile?.real_name?.trim() ?? "";
  if (profileRealName.length > 0) {
    return profileRealName;
  }

  const realName = user.real_name?.trim() ?? "";
  if (realName.length > 0) {
    return realName;
  }

  const name = user.name?.trim() ?? "";
  return name.length === 0 ? user.id : name;
}

function toDiscoveredUserResource(user: SlackUser): DiscoveredIntegrationResource {
  const name = user.name?.trim() ?? "";
  const displayName = resolveSlackUserDisplayName(user);

  return {
    externalId: user.id,
    handle: user.id,
    displayName,
    metadata: {
      ...(name.length === 0 ? {} : { name }),
      ...(user.real_name === undefined ? {} : { realName: user.real_name }),
      ...(user.profile?.display_name === undefined
        ? {}
        : { profileDisplayName: user.profile.display_name }),
      ...(user.profile?.real_name === undefined ? {} : { profileRealName: user.profile.real_name }),
      ...(user.profile?.image_48 === undefined ? {} : { image48: user.profile.image_48 }),
      ...(user.team_id === undefined ? {} : { teamId: user.team_id }),
      ...(user.tz === undefined ? {} : { timezone: user.tz }),
      deleted: user.deleted ?? false,
      isBot: user.is_bot ?? false,
      isAppUser: user.is_app_user ?? false,
      isWorkflowBot: user.is_workflow_bot ?? false,
    },
  };
}

function toDiscoveredUserGroupResource(userGroup: SlackUserGroup): DiscoveredIntegrationResource {
  const handle = userGroup.handle?.trim() ?? "";
  const name = userGroup.name?.trim() ?? "";
  const displayName = handle.length > 0 ? `@${handle}` : name.length > 0 ? name : userGroup.id;

  return {
    externalId: userGroup.id,
    handle: userGroup.id,
    displayName,
    metadata: {
      ...(handle.length === 0 ? {} : { handle }),
      ...(name.length === 0 ? {} : { name }),
      ...(userGroup.description === undefined ? {} : { description: userGroup.description }),
      ...(userGroup.team_id === undefined ? {} : { teamId: userGroup.team_id }),
      ...(userGroup.user_count === undefined ? {} : { userCount: userGroup.user_count }),
      isUserGroup: userGroup.is_usergroup ?? false,
      isExternal: userGroup.is_external ?? false,
      dateDelete: userGroup.date_delete ?? 0,
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

async function listSlackUsers(input: {
  apiBaseUrl: string;
  botToken: string;
}): Promise<ReadonlyArray<DiscoveredIntegrationResource>> {
  const users: DiscoveredIntegrationResource[] = [];
  let nextCursor: string | undefined;

  for (;;) {
    const response = await fetch(
      buildSlackUsersListUrl({
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
      throw new Error(`Slack users.list request failed with status ${String(response.status)}.`);
    }

    const parsedPayload = SlackUsersListResponseSchema.parse(await response.json());
    if (!parsedPayload.ok) {
      throw new Error(
        `Slack users.list returned an error${parsedPayload.error === undefined ? "." : `: ${parsedPayload.error}.`}`,
      );
    }

    for (const user of parsedPayload.members ?? []) {
      if (user.deleted === true) {
        continue;
      }

      users.push(toDiscoveredUserResource(user));
    }

    const candidateCursor = parsedPayload.response_metadata?.next_cursor?.trim() ?? "";
    if (candidateCursor.length === 0) {
      break;
    }

    nextCursor = candidateCursor;
  }

  return users.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

async function listSlackUserGroups(input: {
  apiBaseUrl: string;
  botToken: string;
}): Promise<ReadonlyArray<DiscoveredIntegrationResource>> {
  const response = await fetch(
    buildSlackUserGroupsListUrl({
      apiBaseUrl: input.apiBaseUrl,
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
    throw new Error(`Slack usergroups.list request failed with status ${String(response.status)}.`);
  }

  const parsedPayload = SlackUserGroupsListResponseSchema.parse(await response.json());
  if (!parsedPayload.ok) {
    throw new Error(
      `Slack usergroups.list returned an error${parsedPayload.error === undefined ? "." : `: ${parsedPayload.error}.`}`,
    );
  }

  const userGroups = (parsedPayload.usergroups ?? [])
    .filter((userGroup) => (userGroup.date_delete ?? 0) === 0)
    .map((userGroup) => toDiscoveredUserGroupResource(userGroup));

  return userGroups.sort((left, right) => left.displayName.localeCompare(right.displayName));
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

  SlackConnectionConfigSchema.parse(input.connection.config);

  if (input.kind === SlackChannelKind) {
    return {
      resources: await listSlackChannels({
        apiBaseUrl: input.target.config.apiBaseUrl,
        botToken: input.credential.value,
      }),
    };
  }

  if (input.kind === SlackUserKind) {
    return {
      resources: await listSlackUsers({
        apiBaseUrl: input.target.config.apiBaseUrl,
        botToken: input.credential.value,
      }),
    };
  }

  if (input.kind === SlackUserGroupKind) {
    return {
      resources: await listSlackUserGroups({
        apiBaseUrl: input.target.config.apiBaseUrl,
        botToken: input.credential.value,
      }),
    };
  }

  throw new Error(`Unsupported Slack resource kind '${input.kind}'.`);
}

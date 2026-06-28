import { buildUrlWithPath } from "@mistle/http";
import type {
  DiscoveredIntegrationResourceAttribute,
  DiscoveredIntegrationResource,
  DiscoveredIntegrationResourceRelationship,
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
const SlackWorkspaceKind = "workspace";
const SlackUserKind = "user";
const SlackUserGroupKind = "user_group";
const SlackUsersListLimit = "200";

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

const SlackAuthTestResponseSchema = z.looseObject({
  ok: z.boolean(),
  url: z.url().optional(),
  team: z.string().min(1).optional(),
  team_id: z.string().min(1).optional(),
  user: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
  bot_id: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
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
type SlackAuthTestResponse = z.output<typeof SlackAuthTestResponseSchema>;
type SlackUserGroup = z.output<typeof SlackUserGroupSchema>;

function buildSlackAuthTestUrl(input: { apiBaseUrl: string }): URL {
  return new URL(buildUrlWithPath(input.apiBaseUrl, "/auth.test"));
}

function buildSlackConversationsListUrl(input: { apiBaseUrl: string; cursor?: string }): URL {
  const apiUrl = new URL(buildUrlWithPath(input.apiBaseUrl, "/conversations.list"));
  apiUrl.searchParams.set("types", "public_channel,private_channel");
  apiUrl.searchParams.set("exclude_archived", "true");
  if (input.cursor !== undefined && input.cursor.length > 0) {
    apiUrl.searchParams.set("cursor", input.cursor);
  }
  return apiUrl;
}

function buildSlackUsersListUrl(input: {
  apiBaseUrl: string;
  cursor?: string;
  teamId?: string;
}): URL {
  const apiUrl = new URL(buildUrlWithPath(input.apiBaseUrl, "/users.list"));
  apiUrl.searchParams.set("limit", SlackUsersListLimit);
  if (input.teamId !== undefined) {
    apiUrl.searchParams.set("team_id", input.teamId);
  }
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

function toDiscoveredWorkspaceResource(
  authTest: SlackAuthTestResponse & { team_id: string },
): DiscoveredIntegrationResource {
  return {
    externalId: authTest.team_id,
    handle: authTest.team_id,
    displayName: authTest.team ?? authTest.team_id,
    metadata: {
      ...(authTest.team === undefined ? {} : { name: authTest.team }),
      ...(authTest.url === undefined ? {} : { url: authTest.url }),
      ...(authTest.user === undefined ? {} : { authenticatedUserName: authTest.user }),
      ...(authTest.user_id === undefined ? {} : { authenticatedUserId: authTest.user_id }),
      ...(authTest.bot_id === undefined ? {} : { authenticatedBotId: authTest.bot_id }),
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

function toDiscoveredUserAttribute(input: {
  user: SlackUser;
  key: string;
  value: boolean;
}): DiscoveredIntegrationResourceAttribute {
  return {
    resourceKind: SlackUserKind,
    resourceExternalId: input.user.id,
    resourceHandle: input.user.id,
    key: input.key,
    value: input.value ? "true" : "false",
    valueType: "boolean",
    metadata: {},
  };
}

function toDiscoveredUserAttributes(
  user: SlackUser,
): ReadonlyArray<DiscoveredIntegrationResourceAttribute> {
  return [
    toDiscoveredUserAttribute({
      user,
      key: "is_bot",
      value: user.is_bot ?? false,
    }),
    toDiscoveredUserAttribute({
      user,
      key: "is_app_user",
      value: user.is_app_user ?? false,
    }),
    toDiscoveredUserAttribute({
      user,
      key: "is_workflow_bot",
      value: user.is_workflow_bot ?? false,
    }),
  ];
}

function toDiscoveredWorkspaceMembership(input: {
  user: SlackUser & { team_id: string };
  workspaceExternalId: string;
  workspaceHandle: string;
}): DiscoveredIntegrationResourceRelationship {
  return {
    relationshipKind: "belongs_to",
    subjectResourceKind: SlackUserKind,
    subjectExternalId: input.user.id,
    subjectHandle: input.user.id,
    objectResourceKind: SlackWorkspaceKind,
    objectExternalId: input.workspaceExternalId,
    objectHandle: input.workspaceHandle,
    scopeKind: SlackWorkspaceKind,
    scopeExternalId: input.workspaceExternalId,
    scopeHandle: input.workspaceHandle,
    metadata: {
      teamId: input.user.team_id,
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

async function listSlackWorkspace(input: {
  apiBaseUrl: string;
  botToken: string;
}): Promise<ReadonlyArray<DiscoveredIntegrationResource>> {
  const response = await fetch(
    buildSlackAuthTestUrl({
      apiBaseUrl: input.apiBaseUrl,
    }),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.botToken}`,
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(),
    },
  );

  if (!response.ok) {
    throw new Error(`Slack auth.test request failed with status ${String(response.status)}.`);
  }

  const parsedPayload = SlackAuthTestResponseSchema.parse(await response.json());
  if (!parsedPayload.ok) {
    throw new Error(
      `Slack auth.test returned an error${parsedPayload.error === undefined ? "." : `: ${parsedPayload.error}.`}`,
    );
  }

  if (parsedPayload.team_id === undefined) {
    throw new Error("Slack auth.test response is missing required `team_id`.");
  }

  return [toDiscoveredWorkspaceResource({ ...parsedPayload, team_id: parsedPayload.team_id })];
}

async function listSlackUsers(input: {
  apiBaseUrl: string;
  botToken: string;
  teamId?: string;
}): Promise<ReadonlyArray<SlackUser>> {
  const users: SlackUser[] = [];
  let nextCursor: string | undefined;

  for (;;) {
    const response = await fetch(
      buildSlackUsersListUrl({
        apiBaseUrl: input.apiBaseUrl,
        ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
        ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
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

      users.push(user);
    }

    const candidateCursor = parsedPayload.response_metadata?.next_cursor?.trim() ?? "";
    if (candidateCursor.length === 0) {
      break;
    }

    nextCursor = candidateCursor;
  }

  return users;
}

async function listSlackUserResources(input: {
  apiBaseUrl: string;
  botToken: string;
}): Promise<ListConnectionResourcesResult> {
  const users = await listSlackUsers(input);
  const attributes = users.flatMap((user) => toDiscoveredUserAttributes(user));

  return {
    resources: users
      .map((user) => toDiscoveredUserResource(user))
      .sort((left, right) => left.displayName.localeCompare(right.displayName)),
    attributes: attributes.sort((left, right) => {
      const resourceComparison = left.resourceHandle.localeCompare(right.resourceHandle);
      return resourceComparison === 0 ? left.key.localeCompare(right.key) : resourceComparison;
    }),
  };
}

async function listSlackWorkspaceMembershipRelationships(input: {
  apiBaseUrl: string;
  botToken: string;
  scopeExternalId: string;
  scopeHandle: string;
}): Promise<ReadonlyArray<DiscoveredIntegrationResourceRelationship>> {
  const users = await listSlackUsers({
    apiBaseUrl: input.apiBaseUrl,
    botToken: input.botToken,
    teamId: input.scopeExternalId,
  });

  return users
    .filter(
      (user): user is SlackUser & { team_id: string } => user.team_id === input.scopeExternalId,
    )
    .map((user) =>
      toDiscoveredWorkspaceMembership({
        user,
        workspaceExternalId: input.scopeExternalId,
        workspaceHandle: input.scopeHandle,
      }),
    )
    .sort((left, right) => left.subjectHandle.localeCompare(right.subjectHandle));
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

  if (input.kind === SlackWorkspaceKind) {
    const resources = await listSlackWorkspace({
      apiBaseUrl: input.target.config.apiBaseUrl,
      botToken: input.credential.value,
    });
    const workspace = resources[0];
    if (workspace === undefined || workspace.externalId === undefined) {
      throw new Error("Slack workspace resource listing did not return a scoped workspace.");
    }

    return {
      resources,
      relationships: await listSlackWorkspaceMembershipRelationships({
        apiBaseUrl: input.target.config.apiBaseUrl,
        botToken: input.credential.value,
        scopeExternalId: workspace.externalId,
        scopeHandle: workspace.handle,
      }),
    };
  }

  if (input.kind === SlackChannelKind) {
    return {
      resources: await listSlackChannels({
        apiBaseUrl: input.target.config.apiBaseUrl,
        botToken: input.credential.value,
      }),
    };
  }

  if (input.kind === SlackUserKind) {
    return await listSlackUserResources({
      apiBaseUrl: input.target.config.apiBaseUrl,
      botToken: input.credential.value,
    });
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

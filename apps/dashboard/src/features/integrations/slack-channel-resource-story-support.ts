import type { IntegrationConnectionResources } from "./integrations-service.js";

export function createSlackChannelResource(input: {
  index: number;
  externalId: string;
  displayName: string;
}): IntegrationConnectionResources["items"][number] {
  return {
    id: `icr_slack_channel_${input.index.toString()}`,
    familyId: "slack",
    kind: "channel",
    externalId: input.externalId,
    handle: input.externalId,
    displayName: input.displayName,
    status: "accessible",
    metadata: {},
  };
}

export function createSlackChannelResources(input: {
  connectionId: string;
  items: readonly IntegrationConnectionResources["items"][number][];
}): IntegrationConnectionResources {
  return {
    connectionId: input.connectionId,
    familyId: "slack",
    kind: "channel",
    syncState: "ready",
    lastSyncedAt: "2026-03-17T00:00:00.000Z",
    items: input.items,
  };
}

export function createSlackUserResource(input: {
  index: number;
  externalId: string;
  displayName: string;
  isBot?: boolean;
}): IntegrationConnectionResources["items"][number] {
  return {
    id: `icr_slack_user_${input.index.toString()}`,
    familyId: "slack",
    kind: "user",
    externalId: input.externalId,
    handle: input.externalId,
    displayName: input.displayName,
    status: "accessible",
    metadata: {
      isBot: input.isBot ?? false,
    },
  };
}

export function createSlackUserResources(input: {
  connectionId: string;
  items: readonly IntegrationConnectionResources["items"][number][];
}): IntegrationConnectionResources {
  return {
    connectionId: input.connectionId,
    familyId: "slack",
    kind: "user",
    syncState: "ready",
    lastSyncedAt: "2026-03-17T00:00:00.000Z",
    items: input.items,
  };
}

export function createSlackUserGroupResource(input: {
  index: number;
  externalId: string;
  handle: string;
  displayName: string;
  userCount: number;
}): IntegrationConnectionResources["items"][number] {
  return {
    id: `icr_slack_user_group_${input.index.toString()}`,
    familyId: "slack",
    kind: "user_group",
    externalId: input.externalId,
    handle: input.externalId,
    displayName: input.displayName,
    status: "accessible",
    metadata: {
      handle: input.handle,
      userCount: input.userCount,
    },
  };
}

export function createSlackUserGroupResources(input: {
  connectionId: string;
  items: readonly IntegrationConnectionResources["items"][number][];
}): IntegrationConnectionResources {
  return {
    connectionId: input.connectionId,
    familyId: "slack",
    kind: "user_group",
    syncState: "ready",
    lastSyncedAt: "2026-03-17T00:00:00.000Z",
    items: input.items,
  };
}

export const StoryManySlackChannelResources = createSlackChannelResources({
  connectionId: "conn_slack_prod",
  items: [
    createSlackChannelResource({ index: 1, externalId: "C_ENG_DAILY", displayName: "#eng-daily" }),
    createSlackChannelResource({
      index: 2,
      externalId: "C_ENG_DEPLOY",
      displayName: "#eng-deploy",
    }),
    createSlackChannelResource({ index: 3, externalId: "C_ENG_INFRA", displayName: "#eng-infra" }),
    createSlackChannelResource({
      index: 4,
      externalId: "C_ENG_MONITOR",
      displayName: "#eng-monitor",
    }),
    createSlackChannelResource({
      index: 5,
      externalId: "C_ENG_PRODUCTION_DEPLOY",
      displayName: "#eng-production-deploy",
    }),
    createSlackChannelResource({
      index: 6,
      externalId: "C_ENG_STAGING_DEPLOY",
      displayName: "#eng-staging-deploy",
    }),
    createSlackChannelResource({
      index: 7,
      externalId: "C_ENGINEERING",
      displayName: "#engineering",
    }),
    createSlackChannelResource({ index: 8, externalId: "C_INCIDENTS", displayName: "#incidents" }),
    createSlackChannelResource({
      index: 9,
      externalId: "C_PLATFORM_API",
      displayName: "#platform-api",
    }),
    createSlackChannelResource({
      index: 10,
      externalId: "C_PLATFORM_DASHBOARD",
      displayName: "#platform-dashboard",
    }),
    createSlackChannelResource({
      index: 11,
      externalId: "C_PLATFORM_DATA_PLANE",
      displayName: "#platform-data-plane",
    }),
    createSlackChannelResource({
      index: 12,
      externalId: "C_PLATFORM_RUNTIME",
      displayName: "#platform-runtime",
    }),
    createSlackChannelResource({
      index: 13,
      externalId: "C_PLATFORM_SECURITY",
      displayName: "#platform-security",
    }),
    createSlackChannelResource({
      index: 14,
      externalId: "C_RELEASE_COORDINATION",
      displayName: "#release-coordination",
    }),
    createSlackChannelResource({
      index: 15,
      externalId: "C_SANDBOX_LIFECYCLE",
      displayName: "#sandbox-lifecycle",
    }),
    createSlackChannelResource({
      index: 16,
      externalId: "C_SANDBOX_RUNTIME",
      displayName: "#sandbox-runtime",
    }),
    createSlackChannelResource({
      index: 17,
      externalId: "C_SUPPORT_TRIAGE",
      displayName: "#support-triage",
    }),
    createSlackChannelResource({
      index: 18,
      externalId: "C_TEAM_PRODUCT",
      displayName: "#team-product",
    }),
    createSlackChannelResource({
      index: 19,
      externalId: "C_TEAM_SUCCESS",
      displayName: "#team-success",
    }),
    createSlackChannelResource({
      index: 20,
      externalId: "C_TEAM_GROWTH",
      displayName: "#team-growth",
    }),
    createSlackChannelResource({
      index: 21,
      externalId: "C_TESTING_FLAKY_ALERTS",
      displayName: "#testing-flaky-alerts",
    }),
    createSlackChannelResource({
      index: 22,
      externalId: "C_WEBHOOKS_GITHUB",
      displayName: "#webhooks-github",
    }),
    createSlackChannelResource({
      index: 23,
      externalId: "C_WEBHOOKS_SLACK",
      displayName: "#webhooks-slack",
    }),
    createSlackChannelResource({
      index: 24,
      externalId: "C_WEBHOOKS_WHATSAPP",
      displayName: "#webhooks-whatsapp",
    }),
  ],
});

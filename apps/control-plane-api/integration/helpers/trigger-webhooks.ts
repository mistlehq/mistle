import {
  TriggerKinds,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  IntegrationWebhookSourceStatuses,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { IntegrationWebhookTriggerCapabilitiesProviderMetadataKey } from "@mistle/integrations-core";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";

import { seedIntegrationTarget } from "./integration-connections.js";
import {
  integrationConnectionRow,
  sandboxProfileRow,
  sandboxProfileVersionIntegrationBindingRow,
  sandboxProfileVersionRow,
} from "./sandbox-profiles.js";

export const GitHubTriggerTargetKey = "github-cloud-trigger-webhooks";
export const OpenAiTriggerTargetKey = "openai-default-trigger-webhooks";

const TestCreatedAt = "2026-02-01T00:00:00.000Z";
export const GitHubIssueCommentCreatedEventType = "github.issue_comment.created";
const GitHubWebhookSourceProviderMetadata = {
  // Mirrors the GitHub App manifest metadata shape produced by production provider-app setup.
  // See packages/integrations-definitions/src/github/shared/app-manifest.ts.
  [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
    events: ["issue_comment"],
    permissions: [
      { permission: "issues", access: "write" },
      { permission: "issues", access: "read" },
    ],
  },
};

export async function seedTriggerWebhookTargets(env: IntegrationTestEnvironment): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: GitHubTriggerTargetKey,
    familyId: "github",
    variantId: "github-cloud",
    config: {
      base_url: "https://github.com",
    },
  });
  await seedIntegrationTarget(env, {
    targetKey: OpenAiTriggerTargetKey,
    familyId: "openai",
    variantId: "openai-default",
    config: {
      api_base_url: "https://api.openai.com",
    },
  });
}

export async function seedWebhookTriggerFixture(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    connectionId: string;
    webhookSourceId: string;
    profileId: string;
    profileVersion?: number;
    profileActiveVersion?: number | null;
    targetKey?: string;
    bindingRepositories?: string[];
  },
): Promise<void> {
  const targetKey = input.targetKey ?? GitHubTriggerTargetKey;
  const profileVersion = input.profileVersion ?? 1;

  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
    integrationConnectionRow({
      id: input.connectionId,
      organizationId: input.organizationId,
      targetKey,
      displayName: `${input.connectionId} display`,
      status: IntegrationConnectionStatuses.ACTIVE,
    }),
  );
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationWebhookSources).values({
    id: input.webhookSourceId,
    organizationId: input.organizationId,
    integrationConnectionId: input.connectionId,
    targetKey,
    endpointKey: `ep_${input.webhookSourceId}`,
    status: IntegrationWebhookSourceStatuses.ACTIVE,
    providerMetadata:
      targetKey === GitHubTriggerTargetKey ? GitHubWebhookSourceProviderMetadata : {},
    createdAt: TestCreatedAt,
    updatedAt: TestCreatedAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
    sandboxProfileRow({
      id: input.profileId,
      organizationId: input.organizationId,
      displayName: `${input.profileId} display`,
      createdAt: TestCreatedAt,
      ...(input.profileActiveVersion === undefined
        ? {}
        : { activeVersion: input.profileActiveVersion }),
    }),
  );
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
    sandboxProfileVersionRow({
      sandboxProfileId: input.profileId,
      version: profileVersion,
      state: SandboxProfileVersionStates.PUBLISHED,
      publishedAt: TestCreatedAt,
    }),
  );
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values(
      sandboxProfileVersionIntegrationBindingRow({
        id: `ibd_${input.connectionId}`,
        sandboxProfileId: input.profileId,
        sandboxProfileVersion: profileVersion,
        connectionId: input.connectionId,
        kind: IntegrationBindingKinds.CONNECTOR,
      }),
    );

  if (input.bindingRepositories !== undefined) {
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: `ibd_git_${input.connectionId}`,
          sandboxProfileId: input.profileId,
          sandboxProfileVersion: profileVersion,
          connectionId: input.connectionId,
          kind: IntegrationBindingKinds.GIT,
          config: {
            repositories: input.bindingRepositories,
          },
        }),
      );
  }
}

export async function seedPersistedWebhookTrigger(
  env: IntegrationTestEnvironment,
  input: {
    triggerId: string;
    organizationId: string;
    webhookSourceId: string;
    profileId: string;
    profileVersion: number;
    targetId: string;
    name: string;
    enabled?: boolean;
    primaryRepositoryId?: string | null;
    createdAt?: string;
  },
): Promise<void> {
  const createdAt = input.createdAt ?? TestCreatedAt;

  await env.controlPlaneDb.insert(env.controlPlaneTables.triggers).values({
    id: input.triggerId,
    organizationId: input.organizationId,
    kind: TriggerKinds.WEBHOOK,
    name: input.name,
    enabled: input.enabled ?? true,
    createdAt,
    updatedAt: createdAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.webhookTriggers).values({
    triggerId: input.triggerId,
    integrationWebhookSourceId: input.webhookSourceId,
    eventTypes: [GitHubIssueCommentCreatedEventType],
    payloadFilter: {
      [GitHubIssueCommentCreatedEventType]: {
        op: "eq",
        path: ["action"],
        value: "created",
      },
    },
    inputTemplate: "Handle payload",
    instructions: "Prefer deterministic reproduction steps.",
    conversationKeyTemplate: "{{payload.issue.node_id}}",
    idempotencyKeyTemplate: "{{payload.comment.node_id}}",
    createdAt,
    updatedAt: createdAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.triggerTargets).values({
    id: input.targetId,
    triggerId: input.triggerId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.profileVersion,
    primaryRepositoryId: input.primaryRepositoryId ?? null,
    createdAt,
    updatedAt: createdAt,
  });
}

export function createWebhookTriggerRequestBody(input: {
  name: string;
  integrationWebhookSourceId: string;
  sandboxProfileId: string;
  sandboxProfileVersion?: number;
  primaryRepositoryId?: string | null;
}) {
  return {
    name: input.name,
    enabled: true,
    integrationWebhookSourceId: input.integrationWebhookSourceId,
    eventTypes: [GitHubIssueCommentCreatedEventType],
    payloadFilter: {
      [GitHubIssueCommentCreatedEventType]: {
        op: "eq",
        path: ["action"],
        value: "created",
      },
    },
    inputTemplate: "Handle {{payload.comment.body}}",
    instructions: "Prefer concise triage summaries.",
    conversationKeyTemplate: "{{payload.issue.node_id}}",
    idempotencyKeyTemplate: "{{payload.comment.node_id}}",
    target: {
      sandboxProfileId: input.sandboxProfileId,
      ...(input.sandboxProfileVersion === undefined
        ? {}
        : { sandboxProfileVersion: input.sandboxProfileVersion }),
      ...(input.primaryRepositoryId === undefined
        ? {}
        : { primaryRepositoryId: input.primaryRepositoryId }),
    },
  };
}

/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  TriggerConversationCreatedByKinds,
  TriggerConversationOwnerKinds,
  TriggerConversationRouteStatuses,
  TriggerConversationStatuses,
  SandboxProfileStatuses,
} from "@mistle/db/control-plane";
import { SandboxInstancePurposes, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import { SandboxInstanceStatusResponseSchema } from "../src/sandbox-instances/index.js";
import { createApiKeyToken } from "./helpers/api-keys.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("sandbox instances get integration", () => {
  it("includes active trigger conversation metadata for route-bound sandboxes", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-get-route-bound@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_route_bound_001",
      title: "Webhook investigation",
    });
    await seedTriggerConversation(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_route_bound_001",
      sandboxProfileId: "sbp_cp_get_route_bound_001",
      conversationId: "cnv_cp_get_route_bound_001",
      routeId: "cvr_cp_get_route_bound_001",
      providerConversationId: "thread_cp_get_route_bound_001",
      conversationStatus: TriggerConversationStatuses.ACTIVE,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_get_route_bound_001",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());

    expect(body).toMatchObject({
      id: "sbi_cp_get_route_bound_001",
      title: "Webhook investigation",
      status: SandboxInstanceStatuses.PENDING,
      connectable: false,
      triggerConversation: {
        conversationId: "cnv_cp_get_route_bound_001",
        routeId: "cvr_cp_get_route_bound_001",
        providerConversationId: "thread_cp_get_route_bound_001",
      },
    });
  });

  it("includes pending trigger conversation metadata while the route is preparing", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-get-pending-route@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_pending_route_001",
      title: null,
    });
    await seedTriggerConversation(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_pending_route_001",
      sandboxProfileId: "sbp_cp_get_pending_route_001",
      conversationId: "cnv_cp_get_pending_route_001",
      routeId: "cvr_cp_get_pending_route_001",
      providerConversationId: null,
      conversationStatus: TriggerConversationStatuses.PENDING,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_get_pending_route_001",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());

    expect(body.triggerConversation).toEqual({
      conversationId: "cnv_cp_get_pending_route_001",
      routeId: "cvr_cp_get_pending_route_001",
      providerConversationId: null,
    });
  });

  it("returns null trigger conversation metadata when the sandbox is unbound", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-get-unbound@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_unbound_001",
      title: null,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_get_unbound_001",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());
    expect(body.triggerConversation).toBeNull();
  });

  it("returns the most recently updated active trigger conversation route", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-get-newest-route@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_newest_route_001",
      title: null,
    });
    await seedTriggerConversation(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_newest_route_001",
      sandboxProfileId: "sbp_cp_get_newest_route_001",
      conversationId: "cnv_cp_get_newest_route_old",
      routeId: "cvr_cp_get_newest_route_old",
      providerConversationId: "thread_cp_get_newest_route_old",
      conversationStatus: TriggerConversationStatuses.ACTIVE,
      routeUpdatedAt: "2026-03-21T00:00:01.000Z",
    });
    await seedTriggerConversation(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_newest_route_001",
      sandboxProfileId: "sbp_cp_get_newest_route_001",
      conversationId: "cnv_cp_get_newest_route_new",
      routeId: "cvr_cp_get_newest_route_new",
      providerConversationId: null,
      conversationStatus: TriggerConversationStatuses.ACTIVE,
      routeUpdatedAt: "2026-03-21T00:00:02.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_get_newest_route_001",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());
    expect(body.triggerConversation).toEqual({
      conversationId: "cnv_cp_get_newest_route_new",
      routeId: "cvr_cp_get_newest_route_new",
      providerConversationId: null,
    });
  });

  it("derives runtime context from the persisted runtime plan", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-get-runtime-context@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_runtime_context",
      title: "Runtime context session",
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
      sandboxInstanceId: "sbi_cp_get_runtime_context",
      revision: 1,
      compiledRuntimePlan: createRuntimePlan(),
      compiledFromProfileId: "sbp_cp_get_runtime_context",
      compiledFromProfileVersion: 1,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_get_runtime_context",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());
    expect(body.runtimeContext).toEqual({
      agentRuntimeId: "codex",
      launchCwd: "/root/acme/repo-1/packages/app",
      primaryRepositoryRoot: "/root/acme/repo-1",
    });
  });

  it("returns setup-check sandbox instances for dashboard polling", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-get-setup-check@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_setup_check_001",
      title: "Setup check run",
      purpose: SandboxInstancePurposes.SETUP_CHECK,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_get_setup_check_001",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());

    expect(body).toEqual({
      id: "sbi_cp_get_setup_check_001",
      title: "Setup check run",
      status: SandboxInstanceStatuses.PENDING,
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimeContext: null,
      startupOperation: null,
      triggerConversation: null,
    });
  });

  it("returns a sandbox instance in the API key organization", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-get-api-key@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "Sandbox instance reader",
      permissions: [OrganizationPermissions.SANDBOX_SESSION_READ],
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_api_key_001",
      title: "API key readable session",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_get_api_key_001",
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());
    expect(body.id).toBe("sbi_cp_get_api_key_001");
    expect(body.title).toBe("API key readable session");
  });

  it("returns 403 when an API key lacks sandbox session read permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-get-api-key-forbidden@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "Sandbox instance non-reader",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_api_key_forbidden_001",
      title: "Forbidden API key session",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_get_api_key_forbidden_001",
      {
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
    );

    expect(response.status).toBe(403);
  });
});

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    title: string | null;
    purpose?: typeof SandboxInstancePurposes.SETUP_CHECK;
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_cp_get",
    title: input.title,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: null,
    status: SandboxInstanceStatuses.PENDING,
    startedByKind: "user",
    startedById: "usr_cp_get",
    source: "dashboard",
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    createdAt: "2026-03-21T00:00:00.000Z",
    updatedAt: "2026-03-21T00:00:00.000Z",
  });
}

async function seedTriggerConversation(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    sandboxProfileId: string;
    conversationId: string;
    routeId: string;
    providerConversationId: string | null;
    conversationStatus:
      | typeof TriggerConversationStatuses.ACTIVE
      | typeof TriggerConversationStatuses.PENDING;
    routeUpdatedAt?: string;
  },
): Promise<void> {
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfiles)
    .values({
      id: input.sandboxProfileId,
      organizationId: input.organizationId,
      displayName: "Webhook sandbox profile",
      status: SandboxProfileStatuses.ACTIVE,
    })
    .onConflictDoNothing({
      target: env.controlPlaneTables.sandboxProfiles.id,
    });
  await env.controlPlaneDb.insert(env.controlPlaneTables.triggerConversations).values({
    id: input.conversationId,
    organizationId: input.organizationId,
    ownerKind: TriggerConversationOwnerKinds.TRIGGER_TARGET,
    ownerId: `aut_${input.conversationId}`,
    createdByKind: TriggerConversationCreatedByKinds.WEBHOOK,
    createdById: `iwe_${input.conversationId}`,
    sandboxProfileId: input.sandboxProfileId,
    integrationFamilyId: "openai",
    runtimeId: "codex",
    conversationKey: `conversation-${input.conversationId}`,
    status: input.conversationStatus,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.triggerConversationRoutes).values({
    id: input.routeId,
    conversationId: input.conversationId,
    sandboxInstanceId: input.sandboxInstanceId,
    providerConversationId: input.providerConversationId,
    providerExecutionId: null,
    providerState: null,
    status: TriggerConversationRouteStatuses.ACTIVE,
    ...(input.routeUpdatedAt === undefined ? {} : { updatedAt: input.routeUpdatedAt }),
  });
}

function createRuntimePlan() {
  return {
    sandboxProfileId: "sbp_cp_get_runtime_context",
    version: 1,
    image: {
      source: "base",
      imageRef: "registry:runtime-context",
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [
      {
        sourceKind: "git-clone",
        resourceKind: "repository",
        path: "/root/acme/repo-1",
        originUrl: "https://github.com/acme/repo-1.git",
      },
    ],
    agentRuntimes: [
      {
        runtimeId: "codex",
        runtimeKey: "codex-app-server",
        clientId: "codex-cli",
        endpointKey: "app-server",
        ptyLaunch: {
          runtimeId: "codex",
          displayName: "Codex",
          newLaunch: {
            ptySessionId: "cli",
            cols: 120,
            rows: 32,
            cwd: "/root/acme/repo-1/packages/app",
            command: "codex",
            args: [],
          },
          resumeLaunch: {
            ptySessionId: "cli",
            cols: 120,
            rows: 32,
            cwd: "/root/acme/repo-1/packages/app",
            command: "codex",
            args: [],
          },
        },
      },
    ],
  };
}

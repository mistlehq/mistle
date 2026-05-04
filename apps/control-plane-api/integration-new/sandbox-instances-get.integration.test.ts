/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  AutomationConversationCreatedByKinds,
  AutomationConversationOwnerKinds,
  AutomationConversationRouteStatuses,
  AutomationConversationStatuses,
  SandboxProfileStatuses,
} from "@mistle/db/control-plane";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { SandboxInstanceStatusResponseSchema } from "../src/sandbox-instances/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("sandbox instances get integration", () => {
  it("includes active automation conversation metadata for route-bound sandboxes", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-get-route-bound@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_route_bound_001",
      title: "Webhook investigation",
    });
    await seedAutomationConversation(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_route_bound_001",
      sandboxProfileId: "sbp_cp_get_route_bound_001",
      conversationId: "cnv_cp_get_route_bound_001",
      routeId: "cvr_cp_get_route_bound_001",
      providerConversationId: "thread_cp_get_route_bound_001",
      conversationStatus: AutomationConversationStatuses.ACTIVE,
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
      automationConversation: {
        conversationId: "cnv_cp_get_route_bound_001",
        routeId: "cvr_cp_get_route_bound_001",
        providerConversationId: "thread_cp_get_route_bound_001",
      },
    });
  });

  it("includes pending automation conversation metadata while the route is preparing", async ({
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
    await seedAutomationConversation(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_pending_route_001",
      sandboxProfileId: "sbp_cp_get_pending_route_001",
      conversationId: "cnv_cp_get_pending_route_001",
      routeId: "cvr_cp_get_pending_route_001",
      providerConversationId: null,
      conversationStatus: AutomationConversationStatuses.PENDING,
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

    expect(body.automationConversation).toEqual({
      conversationId: "cnv_cp_get_pending_route_001",
      routeId: "cvr_cp_get_pending_route_001",
      providerConversationId: null,
    });
  });

  it("returns null automation conversation metadata when the sandbox is unbound", async ({
    env,
  }) => {
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
    expect(body.automationConversation).toBeNull();
  });

  it("returns the most recently updated active automation conversation route", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-get-newest-route@example.com",
    });

    await insertSandboxInstance(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_newest_route_001",
      title: null,
    });
    await seedAutomationConversation(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_newest_route_001",
      sandboxProfileId: "sbp_cp_get_newest_route_001",
      conversationId: "cnv_cp_get_newest_route_old",
      routeId: "cvr_cp_get_newest_route_old",
      providerConversationId: "thread_cp_get_newest_route_old",
      conversationStatus: AutomationConversationStatuses.ACTIVE,
      routeUpdatedAt: "2026-03-21T00:00:01.000Z",
    });
    await seedAutomationConversation(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_cp_get_newest_route_001",
      sandboxProfileId: "sbp_cp_get_newest_route_001",
      conversationId: "cnv_cp_get_newest_route_new",
      routeId: "cvr_cp_get_newest_route_new",
      providerConversationId: null,
      conversationStatus: AutomationConversationStatuses.ACTIVE,
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
    expect(body.automationConversation).toEqual({
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
      launchCwd: "/root/acme/repo-1/packages/app",
      primaryRepositoryRoot: "/root/acme/repo-1",
    });
  });
});

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    title: string | null;
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
    createdAt: "2026-03-21T00:00:00.000Z",
    updatedAt: "2026-03-21T00:00:00.000Z",
  });
}

async function seedAutomationConversation(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    sandboxProfileId: string;
    conversationId: string;
    routeId: string;
    providerConversationId: string | null;
    conversationStatus:
      | typeof AutomationConversationStatuses.ACTIVE
      | typeof AutomationConversationStatuses.PENDING;
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
  await env.controlPlaneDb.insert(env.controlPlaneTables.automationConversations).values({
    id: input.conversationId,
    organizationId: input.organizationId,
    ownerKind: AutomationConversationOwnerKinds.AUTOMATION_TARGET,
    ownerId: `aut_${input.conversationId}`,
    createdByKind: AutomationConversationCreatedByKinds.WEBHOOK,
    createdById: `iwe_${input.conversationId}`,
    sandboxProfileId: input.sandboxProfileId,
    integrationFamilyId: "openai",
    runtimeId: "codex",
    conversationKey: `conversation-${input.conversationId}`,
    status: input.conversationStatus,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.automationConversationRoutes).values({
    id: input.routeId,
    conversationId: input.conversationId,
    sandboxInstanceId: input.sandboxInstanceId,
    providerConversationId: input.providerConversationId,
    providerExecutionId: null,
    providerState: null,
    status: AutomationConversationRouteStatuses.ACTIVE,
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
        bindingId: "ibd_runtime_context",
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

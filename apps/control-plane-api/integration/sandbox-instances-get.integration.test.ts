import {
  automationConversationRoutes,
  automationConversations,
  AutomationConversationCreatedByKinds,
  AutomationConversationOwnerKinds,
  AutomationConversationStatuses,
  sandboxProfiles,
  SandboxProfileStatuses,
} from "@mistle/db/control-plane";
import {
  sandboxInstanceRuntimePlans,
  sandboxInstances,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import { afterEach, describe, expect } from "vitest";

import { SandboxInstanceStatusResponseSchema } from "../src/sandbox-instances/index.js";
import {
  createDisposableDataPlaneRuntime,
  type DisposableDataPlaneRuntime,
} from "./helpers/disposable-data-plane-runtime.js";
import {
  destroyDockerSandboxContainer,
  startDockerSandboxContainer,
} from "./helpers/docker-sandbox-runtime.js";
import { it } from "./test-context.js";

const startedDataPlaneFixtures: DisposableDataPlaneRuntime[] = [];
const startedSandboxContainerIds: string[] = [];

function createRuntimePlan() {
  return {
    sandboxProfileId: "sbp_cp_get_runtime_context",
    version: 1,
    image: {
      source: "base" as const,
      imageRef: "registry:runtime-context",
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [
      {
        sourceKind: "git-clone" as const,
        resourceKind: "repository" as const,
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

afterEach(async () => {
  while (startedDataPlaneFixtures.length > 0) {
    const fixture = startedDataPlaneFixtures.pop();
    if (fixture !== undefined) {
      await fixture.stop();
    }
  }

  while (startedSandboxContainerIds.length > 0) {
    const containerId = startedSandboxContainerIds.pop();
    if (containerId !== undefined) {
      await destroyDockerSandboxContainer(containerId);
    }
  }
});

describe("sandbox instances get integration", () => {
  it("includes automation conversation metadata when the sandbox is route-bound", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_get_sandbox_instance",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const session = await fixture.authSession({
      email: "integration-sandbox-instances-get@example.com",
    });
    const providerSandboxId = await startDockerSandboxContainer();
    startedSandboxContainerIds.push(providerSandboxId);

    await dataPlaneFixture.db.insert(sandboxInstances).values({
      id: "sbi_cp_get_001",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_dp_get_001",
      title: "Webhook investigation",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId,
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: session.userId,
      source: "webhook",
      createdAt: "2026-03-21T00:00:00.000Z",
      updatedAt: "2026-03-21T00:00:00.000Z",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_cp_get_001",
      organizationId: session.organizationId,
      displayName: "Webhook sandbox profile",
      status: SandboxProfileStatuses.ACTIVE,
    });

    await fixture.db.insert(automationConversations).values({
      id: "cnv_cp_get_001",
      organizationId: session.organizationId,
      ownerKind: AutomationConversationOwnerKinds.AUTOMATION_TARGET,
      ownerId: "aut_cp_get_001",
      createdByKind: AutomationConversationCreatedByKinds.WEBHOOK,
      createdById: "iwe_cp_get_001",
      sandboxProfileId: "sbp_cp_get_001",
      integrationFamilyId: "openai",
      runtimeId: "codex",
      conversationKey: "webhook-conversation-key",
      status: AutomationConversationStatuses.ACTIVE,
    });

    await fixture.db.insert(automationConversationRoutes).values({
      id: "cvr_cp_get_001",
      conversationId: "cnv_cp_get_001",
      sandboxInstanceId: "sbi_cp_get_001",
      providerConversationId: "thread_cp_get_001",
      providerExecutionId: null,
      providerState: null,
      status: "active",
    });
    await dataPlaneFixture.attachSandboxRuntime({
      sandboxInstanceId: "sbi_cp_get_001",
    });

    const response = await fixture.request("/v1/sandbox/instances/sbi_cp_get_001", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());

    expect(body).toEqual({
      id: "sbi_cp_get_001",
      title: "Webhook investigation",
      status: "starting",
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimeContext: null,
      automationConversation: {
        conversationId: "cnv_cp_get_001",
        routeId: "cvr_cp_get_001",
        providerConversationId: "thread_cp_get_001",
      },
    });
  });

  it("includes pending automation conversation metadata while the route is preparing", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_get_sandbox_instance",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const session = await fixture.authSession({
      email: "integration-sandbox-instances-get-pending@example.com",
    });
    const providerSandboxId = await startDockerSandboxContainer();
    startedSandboxContainerIds.push(providerSandboxId);

    await dataPlaneFixture.db.insert(sandboxInstances).values({
      id: "sbi_cp_get_pending_001",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_dp_get_pending_001",
      title: null,
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId,
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: session.userId,
      source: "webhook",
      createdAt: "2026-03-21T00:00:00.000Z",
      updatedAt: "2026-03-21T00:00:00.000Z",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_cp_get_pending_001",
      organizationId: session.organizationId,
      displayName: "Webhook sandbox profile pending",
      status: SandboxProfileStatuses.ACTIVE,
    });

    await fixture.db.insert(automationConversations).values({
      id: "cnv_cp_get_pending_001",
      organizationId: session.organizationId,
      ownerKind: AutomationConversationOwnerKinds.AUTOMATION_TARGET,
      ownerId: "aut_cp_get_pending_001",
      createdByKind: AutomationConversationCreatedByKinds.WEBHOOK,
      createdById: "iwe_cp_get_pending_001",
      sandboxProfileId: "sbp_cp_get_pending_001",
      integrationFamilyId: "openai",
      runtimeId: "codex",
      conversationKey: "webhook-conversation-key-pending",
      status: AutomationConversationStatuses.PENDING,
    });

    await fixture.db.insert(automationConversationRoutes).values({
      id: "cvr_cp_get_pending_001",
      conversationId: "cnv_cp_get_pending_001",
      sandboxInstanceId: "sbi_cp_get_pending_001",
      providerConversationId: null,
      providerExecutionId: null,
      providerState: null,
      status: "active",
    });
    await dataPlaneFixture.attachSandboxRuntime({
      sandboxInstanceId: "sbi_cp_get_pending_001",
    });

    const response = await fixture.request("/v1/sandbox/instances/sbi_cp_get_pending_001", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());

    expect(body).toEqual({
      id: "sbi_cp_get_pending_001",
      title: null,
      status: "starting",
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimeContext: null,
      automationConversation: {
        conversationId: "cnv_cp_get_pending_001",
        routeId: "cvr_cp_get_pending_001",
        providerConversationId: null,
      },
    });
  });

  it("returns null automation conversation metadata when the sandbox is unbound", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_get_sandbox_instance",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const session = await fixture.authSession({
      email: "integration-sandbox-instances-get-unbound@example.com",
    });

    await dataPlaneFixture.db.insert(sandboxInstances).values({
      id: "sbi_cp_get_002",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_dp_get_002",
      title: null,
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-cp-get-002",
      status: SandboxInstanceStatuses.STARTING,
      startedByKind: "user",
      startedById: session.userId,
      source: "dashboard",
      createdAt: "2026-03-21T00:00:00.000Z",
      updatedAt: "2026-03-21T00:00:00.000Z",
    });

    const response = await fixture.request("/v1/sandbox/instances/sbi_cp_get_002", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());

    expect(body.title).toBeNull();
    expect(body.connectable).toBe(false);
    expect(body.automationConversation).toBeNull();
  });

  it("returns the most recently updated automation conversation metadata when multiple active automation conversations match the sandbox", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_get_sandbox_instance",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const session = await fixture.authSession({
      email: "integration-sandbox-instances-get-ambiguous@example.com",
    });
    const providerSandboxId = await startDockerSandboxContainer();
    startedSandboxContainerIds.push(providerSandboxId);

    await dataPlaneFixture.db.insert(sandboxInstances).values({
      id: "sbi_cp_get_003",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_dp_get_003",
      title: null,
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId,
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: session.userId,
      source: "webhook",
      createdAt: "2026-03-21T00:00:00.000Z",
      updatedAt: "2026-03-21T00:00:00.000Z",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_cp_get_003",
      organizationId: session.organizationId,
      displayName: "Webhook sandbox profile ambiguous",
      status: SandboxProfileStatuses.ACTIVE,
    });

    await fixture.db.insert(automationConversations).values([
      {
        id: "cnv_cp_get_003_a",
        organizationId: session.organizationId,
        ownerKind: AutomationConversationOwnerKinds.AUTOMATION_TARGET,
        ownerId: "aut_cp_get_003_a",
        createdByKind: AutomationConversationCreatedByKinds.WEBHOOK,
        createdById: "iwe_cp_get_003_a",
        sandboxProfileId: "sbp_cp_get_003",
        integrationFamilyId: "openai",
        runtimeId: "codex",
        conversationKey: "webhook-conversation-key-003-a",
        status: AutomationConversationStatuses.ACTIVE,
      },
      {
        id: "cnv_cp_get_003_b",
        organizationId: session.organizationId,
        ownerKind: AutomationConversationOwnerKinds.AUTOMATION_TARGET,
        ownerId: "aut_cp_get_003_b",
        createdByKind: AutomationConversationCreatedByKinds.WEBHOOK,
        createdById: "iwe_cp_get_003_b",
        sandboxProfileId: "sbp_cp_get_003",
        integrationFamilyId: "openai",
        runtimeId: "codex",
        conversationKey: "webhook-conversation-key-003-b",
        status: AutomationConversationStatuses.ACTIVE,
      },
    ]);

    await fixture.db.insert(automationConversationRoutes).values([
      {
        id: "cvr_cp_get_003_a",
        conversationId: "cnv_cp_get_003_a",
        sandboxInstanceId: "sbi_cp_get_003",
        providerConversationId: "thread_cp_get_003_a",
        providerExecutionId: null,
        providerState: null,
        status: "active",
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-21T00:00:02.000Z",
      },
      {
        id: "cvr_cp_get_003_b",
        conversationId: "cnv_cp_get_003_b",
        sandboxInstanceId: "sbi_cp_get_003",
        providerConversationId: "thread_cp_get_003_b",
        providerExecutionId: null,
        providerState: null,
        status: "active",
        createdAt: "2026-03-21T00:00:01.000Z",
        updatedAt: "2026-03-21T00:00:01.000Z",
      },
    ]);
    await dataPlaneFixture.attachSandboxRuntime({
      sandboxInstanceId: "sbi_cp_get_003",
    });

    const response = await fixture.request("/v1/sandbox/instances/sbi_cp_get_003", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());

    expect(body).toEqual({
      id: "sbi_cp_get_003",
      title: null,
      status: "starting",
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimeContext: null,
      automationConversation: {
        conversationId: "cnv_cp_get_003_a",
        routeId: "cvr_cp_get_003_a",
        providerConversationId: "thread_cp_get_003_a",
      },
    });
  });

  it("returns the newest route even when its provider conversation id is still pending", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_get_sandbox_instance",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const session = await fixture.authSession({
      email: "integration-sandbox-instances-get-pending-newest@example.com",
    });
    const providerSandboxId = await startDockerSandboxContainer();
    startedSandboxContainerIds.push(providerSandboxId);

    await dataPlaneFixture.db.insert(sandboxInstances).values({
      id: "sbi_cp_get_004",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_dp_get_004",
      title: null,
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId,
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: session.userId,
      source: "webhook",
      createdAt: "2026-03-21T00:00:00.000Z",
      updatedAt: "2026-03-21T00:00:00.000Z",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_cp_get_004",
      organizationId: session.organizationId,
      displayName: "Webhook sandbox profile pending newest",
      status: SandboxProfileStatuses.ACTIVE,
    });

    await fixture.db.insert(automationConversations).values([
      {
        id: "cnv_cp_get_004_a",
        organizationId: session.organizationId,
        ownerKind: AutomationConversationOwnerKinds.AUTOMATION_TARGET,
        ownerId: "aut_cp_get_004_a",
        createdByKind: AutomationConversationCreatedByKinds.WEBHOOK,
        createdById: "iwe_cp_get_004_a",
        sandboxProfileId: "sbp_cp_get_004",
        integrationFamilyId: "openai",
        runtimeId: "codex",
        conversationKey: "webhook-conversation-key-004-a",
        status: AutomationConversationStatuses.ACTIVE,
      },
      {
        id: "cnv_cp_get_004_b",
        organizationId: session.organizationId,
        ownerKind: AutomationConversationOwnerKinds.AUTOMATION_TARGET,
        ownerId: "aut_cp_get_004_b",
        createdByKind: AutomationConversationCreatedByKinds.WEBHOOK,
        createdById: "iwe_cp_get_004_b",
        sandboxProfileId: "sbp_cp_get_004",
        integrationFamilyId: "openai",
        runtimeId: "codex",
        conversationKey: "webhook-conversation-key-004-b",
        status: AutomationConversationStatuses.ACTIVE,
      },
    ]);

    await fixture.db.insert(automationConversationRoutes).values([
      {
        id: "cvr_cp_get_004_a",
        conversationId: "cnv_cp_get_004_a",
        sandboxInstanceId: "sbi_cp_get_004",
        providerConversationId: "thread_cp_get_004_a",
        providerExecutionId: null,
        providerState: null,
        status: "active",
        createdAt: "2026-03-21T00:00:00.000Z",
      },
      {
        id: "cvr_cp_get_004_b",
        conversationId: "cnv_cp_get_004_b",
        sandboxInstanceId: "sbi_cp_get_004",
        providerConversationId: null,
        providerExecutionId: null,
        providerState: null,
        status: "active",
        createdAt: "2026-03-21T00:00:01.000Z",
      },
    ]);
    await dataPlaneFixture.attachSandboxRuntime({
      sandboxInstanceId: "sbi_cp_get_004",
    });

    const response = await fixture.request("/v1/sandbox/instances/sbi_cp_get_004", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());

    expect(body).toEqual({
      id: "sbi_cp_get_004",
      title: null,
      status: "starting",
      connectable: false,
      failureCode: null,
      failureMessage: null,
      runtimeContext: null,
      automationConversation: {
        conversationId: "cnv_cp_get_004_b",
        routeId: "cvr_cp_get_004_b",
        providerConversationId: null,
      },
    });
  });

  it("derives runtime context from the persisted runtime plan", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_get_runtime_context",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const session = await fixture.authSession({
      email: "integration-sandbox-instances-get-runtime-context@example.com",
    });

    await dataPlaneFixture.db.insert(sandboxInstances).values({
      id: "sbi_cp_get_runtime_context",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_cp_get_runtime_context",
      title: "Runtime context session",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-cp-get-runtime-context",
      status: SandboxInstanceStatuses.STARTING,
      startedByKind: "user",
      startedById: session.userId,
      source: "dashboard",
      createdAt: "2026-03-21T00:00:00.000Z",
      updatedAt: "2026-03-21T00:00:00.000Z",
    });
    await dataPlaneFixture.db.insert(sandboxInstanceRuntimePlans).values({
      sandboxInstanceId: "sbi_cp_get_runtime_context",
      revision: 1,
      compiledRuntimePlan: createRuntimePlan(),
      compiledFromProfileId: "sbp_cp_get_runtime_context",
      compiledFromProfileVersion: 1,
    });

    const response = await fixture.request("/v1/sandbox/instances/sbi_cp_get_runtime_context", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = SandboxInstanceStatusResponseSchema.parse(await response.json());

    expect(body.runtimeContext).toEqual({
      launchCwd: "/root/acme/repo-1/packages/app",
      primaryRepositoryRoot: "/root/acme/repo-1",
    });
  });
});

import {
  automationConversationRoutes,
  automationConversations,
  AutomationConversationCreatedByKinds,
  AutomationConversationOwnerKinds,
  AutomationConversationStatuses,
  sandboxProfiles,
  SandboxProfileStatuses,
} from "@mistle/db/control-plane";
import { sandboxInstances, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { afterEach, describe, expect } from "vitest";

import { SandboxInstanceStatusResponseSchema } from "../src/sandbox-instances/index.js";
import {
  createDisposableDataPlaneRuntime,
  type DisposableDataPlaneRuntime,
} from "./helpers/disposable-data-plane-runtime.js";
import { it } from "./test-context.js";

const startedDataPlaneFixtures: DisposableDataPlaneRuntime[] = [];

afterEach(async () => {
  while (startedDataPlaneFixtures.length > 0) {
    const fixture = startedDataPlaneFixtures.pop();
    if (fixture !== undefined) {
      await fixture.stop();
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
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_get_sandbox_instance",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const session = await fixture.authSession({
      email: "integration-sandbox-instances-get@example.com",
    });

    await dataPlaneFixture.db.insert(sandboxInstances).values({
      id: "sbi_cp_get_001",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_dp_get_001",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-cp-get-001",
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
      conversationKey: "webhook-conversation-key",
      title: null,
      preview: null,
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
      status: "running",
      failureCode: null,
      failureMessage: null,
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
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_get_sandbox_instance",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const session = await fixture.authSession({
      email: "integration-sandbox-instances-get-pending@example.com",
    });

    await dataPlaneFixture.db.insert(sandboxInstances).values({
      id: "sbi_cp_get_pending_001",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_dp_get_pending_001",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-cp-get-pending-001",
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
      conversationKey: "webhook-conversation-key-pending",
      title: null,
      preview: null,
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
      status: "running",
      failureCode: null,
      failureMessage: null,
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

    expect(body.automationConversation).toBeNull();
  });

  it("returns the most recently updated automation conversation metadata when multiple active automation conversations match the sandbox", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_get_sandbox_instance",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const session = await fixture.authSession({
      email: "integration-sandbox-instances-get-ambiguous@example.com",
    });

    await dataPlaneFixture.db.insert(sandboxInstances).values({
      id: "sbi_cp_get_003",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_dp_get_003",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-cp-get-003",
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
        conversationKey: "webhook-conversation-key-003-a",
        title: null,
        preview: null,
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
        conversationKey: "webhook-conversation-key-003-b",
        title: null,
        preview: null,
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
      status: "running",
      failureCode: null,
      failureMessage: null,
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
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_get_sandbox_instance",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const session = await fixture.authSession({
      email: "integration-sandbox-instances-get-pending-newest@example.com",
    });

    await dataPlaneFixture.db.insert(sandboxInstances).values({
      id: "sbi_cp_get_004",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_dp_get_004",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-cp-get-004",
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
        conversationKey: "webhook-conversation-key-004-a",
        title: null,
        preview: null,
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
        conversationKey: "webhook-conversation-key-004-b",
        title: null,
        preview: null,
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
      status: "running",
      failureCode: null,
      failureMessage: null,
      automationConversation: {
        conversationId: "cnv_cp_get_004_b",
        routeId: "cvr_cp_get_004_b",
        providerConversationId: null,
      },
    });
  });
});

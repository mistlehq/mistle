import { randomUUID } from "node:crypto";

import {
  automationConversationRoutes,
  automationConversations,
  AutomationConversationCreatedByKinds,
  AutomationConversationOwnerKinds,
  AutomationConversationStatuses,
  sandboxProfiles,
  SandboxProfileStatuses,
} from "@mistle/db/control-plane";
import { createDataPlaneDatabase as createDataPlaneInstanceDatabase } from "@mistle/db/data-plane";
import { sandboxInstances, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { Client, Pool } from "pg";
import { afterEach, describe, expect } from "vitest";

import { createDataPlaneBackend } from "../../data-plane-api/src/openworkflow/index.js";
import { createDataPlaneApiRuntime } from "../../data-plane-api/src/runtime/index.js";
import type { DataPlaneApiConfig } from "../../data-plane-api/src/types.js";
import { SandboxInstanceStatusResponseSchema } from "../src/sandbox-instances/contracts.js";
import { it } from "./test-context.js";

type StartedDataPlaneFixture = {
  db: ReturnType<typeof createDataPlaneInstanceDatabase>;
  stop: () => Promise<void>;
};

const startedDataPlaneFixtures: StartedDataPlaneFixture[] = [];

afterEach(async () => {
  while (startedDataPlaneFixtures.length > 0) {
    const fixture = startedDataPlaneFixtures.pop();
    if (fixture !== undefined) {
      await fixture.stop();
    }
  }
});

function parseDatabaseConnectionString(connectionString: string): {
  username: string;
  password: string;
  host: string;
  port: number;
} {
  const url = new URL(connectionString);
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error("Expected database connection string to include a valid port.");
  }

  return {
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    host: url.hostname,
    port,
  };
}

function createDatabaseUrl(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
}): string {
  return `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.host}:${String(input.port)}/${input.databaseName}`;
}

async function createStartedDataPlaneFixture(input: {
  controlPlaneDatabaseUrl: string;
  internalAuthServiceToken: string;
  workflowNamespaceId: string;
}): Promise<StartedDataPlaneFixture> {
  const adminConnection = parseDatabaseConnectionString(input.controlPlaneDatabaseUrl);
  const databaseName = `mistle_cp_get_sandbox_instance_${randomUUID().replaceAll("-", "_")}`;
  const databaseUrl = createDatabaseUrl({
    ...adminConnection,
    databaseName,
  });
  const adminClient = new Client({
    connectionString: createDatabaseUrl({
      ...adminConnection,
      databaseName: "postgres",
    }),
  });

  let runtime: Awaited<ReturnType<typeof createDataPlaneApiRuntime>> | undefined;
  let dbPool: Pool | undefined;

  await adminClient.connect();

  try {
    await adminClient.query(`CREATE DATABASE "${databaseName}"`);
    await runDataPlaneMigrations({
      connectionString: databaseUrl,
      schemaName: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
    });

    const workflowBackend = await createDataPlaneBackend({
      url: databaseUrl,
      namespaceId: input.workflowNamespaceId,
      runMigrations: true,
    });
    await workflowBackend.stop();

    dbPool = new Pool({
      connectionString: databaseUrl,
    });

    const config: DataPlaneApiConfig = {
      server: {
        host: "127.0.0.1",
        port: 4000,
      },
      database: {
        url: databaseUrl,
      },
      workflow: {
        databaseUrl,
        namespaceId: input.workflowNamespaceId,
      },
    };

    runtime = await createDataPlaneApiRuntime({
      app: config,
      internalAuthServiceToken: input.internalAuthServiceToken,
      sandboxProvider: "docker",
    });
    await runtime.start();

    return {
      db: createDataPlaneInstanceDatabase(dbPool),
      stop: async () => {
        if (runtime !== undefined) {
          await runtime.stop();
        }
        if (dbPool !== undefined) {
          await dbPool.end();
        }

        await adminClient.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
        await adminClient.end();
      },
    };
  } catch (error) {
    if (runtime !== undefined) {
      await runtime.stop();
    }
    if (dbPool !== undefined) {
      await dbPool.end();
    }

    await adminClient.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await adminClient.end();
    throw error;
  }
}

describe("sandbox instances get integration", () => {
  it("includes automation conversation metadata when the sandbox is route-bound", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createStartedDataPlaneFixture({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
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
      providerRuntimeId: "provider-cp-get-001",
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
    const dataPlaneFixture = await createStartedDataPlaneFixture({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
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
      providerRuntimeId: "provider-cp-get-pending-001",
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
    const dataPlaneFixture = await createStartedDataPlaneFixture({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
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
      providerRuntimeId: "provider-cp-get-002",
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

  it("returns the most recently created automation conversation metadata when multiple active automation conversations match the sandbox", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createStartedDataPlaneFixture({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
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
      providerRuntimeId: "provider-cp-get-003",
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
      },
    ]);

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
        conversationId: "cnv_cp_get_003_b",
        routeId: "cvr_cp_get_003_b",
        providerConversationId: "thread_cp_get_003_b",
      },
    });
  });

  it("returns the newest route even when its provider conversation id is still pending", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createStartedDataPlaneFixture({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
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
      providerRuntimeId: "provider-cp-get-004",
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

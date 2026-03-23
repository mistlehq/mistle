import { randomUUID } from "node:crypto";

import {
  createDataPlaneDatabase,
  sandboxInstances,
  SandboxInstanceVolumeModes,
} from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { reserveAvailablePort } from "@mistle/test-harness";
import { systemSleeper } from "@mistle/time";
import { eq } from "drizzle-orm";
import { Client, Pool } from "pg";
import { afterEach, describe, expect } from "vitest";

import { createDataPlaneBackend } from "../../data-plane-api/src/openworkflow/index.js";
import { createDataPlaneApiRuntime } from "../../data-plane-api/src/runtime/index.js";
import type { DataPlaneApiConfig } from "../../data-plane-api/src/types.js";
import { createControlPlaneApiRuntime } from "../src/main.js";
import {
  SandboxInstanceConnectionTokenSchema,
  SandboxInstancesConflictResponseSchema,
} from "../src/sandbox-instances/contracts.js";
import type { ControlPlaneApiConfig } from "../src/types.js";
import { createAuthenticatedSession } from "./helpers/auth-session.js";
import { it, type ControlPlaneApiIntegrationFixture } from "./test-context.js";

type StartedDataPlaneFixture = {
  baseUrl: string;
  db: ReturnType<typeof createDataPlaneDatabase>;
  dbPool: Pool;
  stop: () => Promise<void>;
};

type WorkflowRunRow = {
  id: string;
};

const ResumeWorkflowName = "data-plane.sandbox-instances.resume";
const WorkflowQueuePollIntervalMs = 100;
const WorkflowQueueWaitTimeoutMs = 10_000;

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
  const databaseName = `mistle_cp_connect_${randomUUID().replaceAll("-", "_")}`;
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

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const config: DataPlaneApiConfig = {
      server: {
        host,
        port,
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
      baseUrl: `http://${host}:${String(port)}`,
      db: createDataPlaneDatabase(dbPool),
      dbPool,
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

function createControlPlaneConfig(input: {
  baseConfig: ControlPlaneApiConfig;
  dataPlaneBaseUrl: string;
}): ControlPlaneApiConfig {
  return {
    ...input.baseConfig,
    dataPlaneApi: {
      baseUrl: input.dataPlaneBaseUrl,
    },
  };
}

async function createAuthenticatedControlPlaneSession(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
  db: Awaited<ReturnType<typeof createControlPlaneApiRuntime>>["db"];
  email: string;
}) {
  return createAuthenticatedSession({
    request: input.request,
    db: input.db,
    otpLength: input.fixture.config.auth.otpLength,
    email: input.email,
  });
}

async function insertSandboxInstance(input: {
  dataPlaneFixture: StartedDataPlaneFixture;
  organizationId: string;
  sandboxInstanceId: string;
  status: "starting" | "running" | "stopped" | "failed";
  providerRuntimeId?: string | null;
  failureCode?: string | null;
  failureMessage?: string | null;
}) {
  await input.dataPlaneFixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_connect_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerRuntimeId: input.providerRuntimeId ?? "provider-runtime-connect-001",
    instanceVolumeProvider: "docker",
    instanceVolumeId: `volume-${input.sandboxInstanceId}`,
    instanceVolumeMode: SandboxInstanceVolumeModes.NATIVE,
    status: input.status,
    startedByKind: "user",
    startedById: "usr_connect_integration",
    source: "dashboard",
    failureCode: input.failureCode ?? null,
    failureMessage: input.failureMessage ?? null,
  });
}

async function updateSandboxInstanceStatus(input: {
  dataPlaneFixture: StartedDataPlaneFixture;
  sandboxInstanceId: string;
  status: "running" | "failed";
  failureCode?: string | null;
  failureMessage?: string | null;
}) {
  await input.dataPlaneFixture.db
    .update(sandboxInstances)
    .set({
      status: input.status,
      failureCode: input.failureCode ?? null,
      failureMessage: input.failureMessage ?? null,
    })
    .where(eq(sandboxInstances.id, input.sandboxInstanceId));
}

async function waitForResumeWorkflowRun(input: {
  dataPlaneFixture: StartedDataPlaneFixture;
  workflowNamespaceId: string;
  sandboxInstanceId: string;
}): Promise<WorkflowRunRow> {
  const deadline = Date.now() + WorkflowQueueWaitTimeoutMs;

  while (Date.now() < deadline) {
    const result = await input.dataPlaneFixture.dbPool.query<WorkflowRunRow>(
      `
        select id
        from data_plane_openworkflow.workflow_runs
        where
          namespace_id = $1
          and workflow_name = $2
          and input->>'sandboxInstanceId' = $3
        order by created_at asc
        limit 1
      `,
      [input.workflowNamespaceId, ResumeWorkflowName, input.sandboxInstanceId],
    );

    const row = result.rows[0];
    if (row !== undefined) {
      return row;
    }

    await systemSleeper.sleep(WorkflowQueuePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued resume workflow run for sandbox instance '${input.sandboxInstanceId}'.`,
  );
}

describe("sandbox instance connect integration", () => {
  it("mints a connection token immediately for running instances", async ({ fixture }) => {
    const dataPlaneFixture = await createStartedDataPlaneFixture({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-connect-running@example.com",
      });

      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId: "sbi_cp_connect_running_001",
        status: "running",
      });

      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_connect_running_001/connection-tokens",
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      expect(response.status).toBe(201);
      const body = SandboxInstanceConnectionTokenSchema.parse(await response.json());
      expect(body.instanceId).toBe("sbi_cp_connect_running_001");
      expect(body.url).toContain("/sbi_cp_connect_running_001?");
      expect(body.token).not.toBe("");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("waits for starting instances to become running before minting a connection token", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createStartedDataPlaneFixture({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-connect-starting@example.com",
      });

      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId: "sbi_cp_connect_starting_001",
        status: "starting",
      });

      const responsePromise = controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_connect_starting_001/connection-tokens",
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      await systemSleeper.sleep(300);
      await updateSandboxInstanceStatus({
        dataPlaneFixture,
        sandboxInstanceId: "sbi_cp_connect_starting_001",
        status: "running",
      });

      const response = await responsePromise;
      expect(response.status).toBe(201);
      const body = SandboxInstanceConnectionTokenSchema.parse(await response.json());
      expect(body.instanceId).toBe("sbi_cp_connect_starting_001");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });

  it("resumes stopped instances through data-plane before minting a connection token", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createStartedDataPlaneFixture({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-connect-stopped@example.com",
      });

      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId: "sbi_cp_connect_stopped_001",
        status: "stopped",
      });

      const responsePromise = controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_connect_stopped_001/connection-tokens",
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      await waitForResumeWorkflowRun({
        dataPlaneFixture,
        workflowNamespaceId: fixture.config.workflow.namespaceId,
        sandboxInstanceId: "sbi_cp_connect_stopped_001",
      });

      await updateSandboxInstanceStatus({
        dataPlaneFixture,
        sandboxInstanceId: "sbi_cp_connect_stopped_001",
        status: "running",
      });

      const response = await responsePromise;
      expect(response.status).toBe(201);
      const body = SandboxInstanceConnectionTokenSchema.parse(await response.json());
      expect(body.instanceId).toBe("sbi_cp_connect_stopped_001");
    } finally {
      await controlPlaneRuntime.stop();
    }
  }, 60_000);

  it("returns INSTANCE_FAILED for failed instances", async ({ fixture }) => {
    const dataPlaneFixture = await createStartedDataPlaneFixture({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const controlPlaneRuntime = await createControlPlaneApiRuntime({
      app: createControlPlaneConfig({
        baseConfig: fixture.config,
        dataPlaneBaseUrl: dataPlaneFixture.baseUrl,
      }),
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      connectionToken: {
        secret: "integration-connection-secret",
        issuer: "integration-issuer",
        audience: "integration-audience",
      },
      sandbox: {
        defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
        gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
      },
    });

    try {
      const authSession = await createAuthenticatedControlPlaneSession({
        fixture,
        request: controlPlaneRuntime.request,
        db: controlPlaneRuntime.db,
        email: "integration-sandbox-connect-failed@example.com",
      });

      await insertSandboxInstance({
        dataPlaneFixture,
        organizationId: authSession.organizationId,
        sandboxInstanceId: "sbi_cp_connect_failed_001",
        status: "failed",
        failureCode: "sandbox_start_failed",
        failureMessage: "Sandbox runtime failed to start.",
      });

      const response = await controlPlaneRuntime.request(
        "/v1/sandbox/instances/sbi_cp_connect_failed_001/connection-tokens",
        {
          method: "POST",
          headers: {
            cookie: authSession.cookie,
          },
        },
      );

      expect(response.status).toBe(409);
      const body = SandboxInstancesConflictResponseSchema.parse(await response.json());
      expect(body.code).toBe("INSTANCE_FAILED");
      expect(body.message).toContain("Sandbox runtime failed to start.");
    } finally {
      await controlPlaneRuntime.stop();
    }
  });
});

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  createDataPlaneDatabase,
  sandboxInstanceDeadlines,
  sandboxInstances,
  SandboxInstanceDeadlineKinds,
  SandboxInstanceStatuses,
  SandboxStopReasons,
} from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { reserveAvailablePort, startPostgresWithPgBouncer } from "@mistle/test-harness";
import { systemClock, systemSleeper } from "@mistle/time";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeWebSocket,
  connectBootstrapSocket,
  mintValidBootstrapToken,
  startGatewayProcess,
  type StartedGatewayProcess,
} from "../../data-plane-api/integration/runtime-status-test-helpers.js";
import {
  createDataPlaneWorkerRuntimeConfig,
  loadDataPlaneWorkerConfig,
  requireDataPlaneWorkerGlobalConfig,
} from "../openworkflow/core/config.js";
import { createSandboxRuntimeAdapter } from "../openworkflow/core/sandbox-runtime-adapter.js";
import { markSandboxInstanceFailed as markSandboxInstanceFailedDuringReconcile } from "../openworkflow/reconcile-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceStopped as markSandboxInstanceStoppedDuringReconcile } from "../openworkflow/reconcile-sandbox-instance/mark-sandbox-instance-stopped.js";
import { handleSandboxInstanceDeadline } from "../openworkflow/sandbox-instance-deadlines/handle-sandbox-instance-deadline.js";
import { markSandboxInstanceFailed as markSandboxInstanceFailedDuringStart } from "../openworkflow/start-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceStopped as markSandboxInstanceStoppedDuringStop } from "../openworkflow/stop-sandbox-instance/mark-sandbox-instance-stopped.js";
import { createSandboxRuntimeStateReader } from "../runtime-state/create-sandbox-runtime-state-reader.js";

const IntegrationTestTimeoutMs = 60_000;
const GatewayPortHost = "127.0.0.1";
const InternalAuthServiceToken = "worker-deadlines-integration-service-token";
const MatchingDeadlineDueAt = "2026-04-14T12:00:00.000Z";
const AlternateDeadlineDueAt = "2026-04-14T12:05:00.000Z";
const RuntimeStateWaitTimeoutMs = 5_000;
const RuntimeStatePollIntervalMs = 50;

type DatabaseStack = {
  directUrl: string;
  stop: () => Promise<void>;
};

let databaseStack: DatabaseStack | undefined;
let dbPool: Pool | undefined;
let gatewayProcess: StartedGatewayProcess | undefined;

function getDatabaseStack(): DatabaseStack {
  if (databaseStack === undefined) {
    throw new Error("Expected integration database stack to be initialized.");
  }

  return databaseStack;
}

function getGatewayProcess(): StartedGatewayProcess {
  if (gatewayProcess === undefined) {
    throw new Error("Expected integration gateway process to be initialized.");
  }

  return gatewayProcess;
}

function getDbPool(): Pool {
  if (dbPool === undefined) {
    throw new Error("Expected integration database pool to be initialized.");
  }

  return dbPool;
}

function createDatabase() {
  return createDataPlaneDatabase(getDbPool());
}

function createDeadlineExecutionContext(input: { gatewayBaseUrl: string }) {
  const runtimeConfig = createWorkerRuntimeConfig({
    gatewayBaseUrl: input.gatewayBaseUrl,
  });

  return {
    config: runtimeConfig,
    db: createDatabase(),
    controlPlaneInternalClient: new ControlPlaneInternalClient({
      baseUrl: "http://127.0.0.1:5100",
      internalAuthServiceToken: InternalAuthServiceToken,
    }),
    sandboxAdapter: createSandboxRuntimeAdapter(runtimeConfig),
    runtimeStateReader: createSandboxRuntimeStateReader({
      gatewayBaseUrl: input.gatewayBaseUrl,
      serviceToken: InternalAuthServiceToken,
    }),
    clock: systemClock,
  };
}

function createWorkerRuntimeConfig(input: { gatewayBaseUrl: string }) {
  const loadedConfig = loadDataPlaneWorkerConfig({
    NODE_ENV: "development",
    MISTLE_GLOBAL_TELEMETRY_ENABLED: "false",
    MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
    MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN: InternalAuthServiceToken,
    MISTLE_GLOBAL_SANDBOX_PROVIDER: "docker",
    MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE: "mistle/sandbox-base:test",
    MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL: `${input.gatewayBaseUrl.replace("http://", "ws://")}/tunnel/sandbox`,
    MISTLE_GLOBAL_SANDBOX_INTERNAL_GATEWAY_WS_URL: `${input.gatewayBaseUrl.replace("http://", "ws://")}/tunnel/sandbox`,
    MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_SECRET: "integration-connect-secret",
    MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_ISSUER: "integration-control-plane-api",
    MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_AUDIENCE: "integration-data-plane-gateway",
    MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_SECRET: "integration-bootstrap-secret",
    MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_ISSUER: "integration-data-plane-worker",
    MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_AUDIENCE: "integration-data-plane-gateway",
    MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_SECRET: "integration-egress-secret",
    MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_ISSUER: "integration-data-plane-worker",
    MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_AUDIENCE: "integration-tokenizer-proxy",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_BASE_DOMAIN: "mistle.example.test",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET: "integration-publish-secret",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER: "integration-control-plane-api",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE: "integration-data-plane-gateway",
    MISTLE_GLOBAL_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET:
      "integration-publish-cookie-secret",
    MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL: getDatabaseStack().directUrl,
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL: getDatabaseStack().directUrl,
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: "data-plane-worker-deadlines-it",
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY: "1",
    MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_BOOTSTRAP_TOKEN_TTL_SECONDS: "120",
    MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_EXCHANGE_TOKEN_TTL_SECONDS: "3600",
    MISTLE_APPS_DATA_PLANE_WORKER_RUNTIME_STATE_GATEWAY_BASE_URL: input.gatewayBaseUrl,
    MISTLE_APPS_DATA_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL: "http://127.0.0.1:5100",
    MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL: "http://127.0.0.1:5400",
    MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH: "/var/run/docker.sock",
    MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_NETWORK_NAME: "mistle-sandbox-dev",
  });
  requireDataPlaneWorkerGlobalConfig(loadedConfig, "data-plane-worker deadline integration tests");

  return createDataPlaneWorkerRuntimeConfig({
    app: loadedConfig.app,
    global: loadedConfig.global,
  });
}

async function insertSandboxInstance(input: {
  sandboxInstanceId: string;
  status: "pending" | "starting" | "running" | "stopped" | "failed";
  providerSandboxId?: string;
  stopReason?: (typeof SandboxStopReasons)[keyof typeof SandboxStopReasons];
  failureCode?: string;
  failureMessage?: string;
}): Promise<void> {
  await createDatabase()
    .insert(sandboxInstances)
    .values({
      id: input.sandboxInstanceId,
      organizationId: `org_${input.sandboxInstanceId}`,
      sandboxProfileId: `sbp_${input.sandboxInstanceId}`,
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      ...(input.providerSandboxId === undefined
        ? {}
        : { providerSandboxId: input.providerSandboxId }),
      status: input.status,
      startedByKind: "system",
      startedById: `worker_${input.sandboxInstanceId}`,
      source: "dashboard",
      ...(input.stopReason === undefined ? {} : { stopReason: input.stopReason }),
      ...(input.failureCode === undefined ? {} : { failureCode: input.failureCode }),
      ...(input.failureMessage === undefined ? {} : { failureMessage: input.failureMessage }),
    });
}

async function insertActiveDeadline(input: {
  sandboxInstanceId: string;
  kind: "idle" | "disconnect";
  ownerLeaseId: string;
  dueAt: string;
  generation?: number;
}): Promise<void> {
  await createDatabase()
    .insert(sandboxInstanceDeadlines)
    .values({
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.kind,
      ownerLeaseId: input.ownerLeaseId,
      dueAt: input.dueAt,
      ...(input.generation === undefined ? {} : { generation: input.generation }),
    });
}

async function insertBothDeadlineKinds(input: { sandboxInstanceId: string }): Promise<void> {
  await createDatabase()
    .insert(sandboxInstanceDeadlines)
    .values([
      {
        sandboxInstanceId: input.sandboxInstanceId,
        kind: SandboxInstanceDeadlineKinds.IDLE,
        ownerLeaseId: `owner_idle_${input.sandboxInstanceId}`,
        dueAt: MatchingDeadlineDueAt,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
        kind: SandboxInstanceDeadlineKinds.DISCONNECT,
        ownerLeaseId: `owner_disconnect_${input.sandboxInstanceId}`,
        dueAt: MatchingDeadlineDueAt,
      },
    ]);
}

async function expectDeadlinesCleared(input: { sandboxInstanceId: string }): Promise<void> {
  const deadlineRows = await createDatabase().query.sandboxInstanceDeadlines.findMany({
    columns: {
      kind: true,
      clearedAt: true,
    },
    where: (table, { eq }) => eq(table.sandboxInstanceId, input.sandboxInstanceId),
    orderBy: (table, { asc }) => asc(table.kind),
  });

  expect(deadlineRows).toEqual([
    {
      kind: SandboxInstanceDeadlineKinds.DISCONNECT,
      clearedAt: expect.any(String),
    },
    {
      kind: SandboxInstanceDeadlineKinds.IDLE,
      clearedAt: expect.any(String),
    },
  ]);
}

async function waitForRuntimeStateOwnerLeaseId(input: {
  gatewayBaseUrl: string;
  sandboxInstanceId: string;
}): Promise<string> {
  const runtimeStateReader = createSandboxRuntimeStateReader({
    gatewayBaseUrl: input.gatewayBaseUrl,
    serviceToken: InternalAuthServiceToken,
  });
  const deadlineMs = systemClock.nowMs() + RuntimeStateWaitTimeoutMs;

  while (systemClock.nowMs() < deadlineMs) {
    const snapshot = await runtimeStateReader.readSnapshot({
      sandboxInstanceId: input.sandboxInstanceId,
      nowMs: systemClock.nowMs(),
    });
    if (
      snapshot.ownerLeaseId !== null &&
      snapshot.attachment?.ownerLeaseId === snapshot.ownerLeaseId
    ) {
      return snapshot.ownerLeaseId;
    }

    await systemSleeper.sleep(RuntimeStatePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for gateway runtime-state attachment for sandbox '${input.sandboxInstanceId}'.`,
  );
}

describe("sandbox instance deadlines integration", () => {
  beforeAll(async () => {
    databaseStack = await startPostgresWithPgBouncer();
    await runDataPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: "data_plane",
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
    });

    dbPool = new Pool({
      connectionString: databaseStack.directUrl,
    });

    gatewayProcess = await startGatewayProcess({
      port: await reserveAvailablePort({ host: GatewayPortHost }),
      databaseUrl: databaseStack.directUrl,
      dataPlaneApiBaseUrl: "http://127.0.0.1:1",
      controlPlaneApiBaseUrl: "http://127.0.0.1:1",
      internalAuthServiceToken: InternalAuthServiceToken,
    });
  }, IntegrationTestTimeoutMs);

  afterAll(async () => {
    await gatewayProcess?.stop();
    await dbPool?.end();
    await databaseStack?.stop();
  });

  beforeEach(async () => {
    await createDatabase().delete(sandboxInstanceDeadlines);
    await createDatabase().delete(sandboxInstances);
  });

  it(
    "returns executed false when an idle deadline no longer matches runtime-state ownership",
    async () => {
      const sandboxInstanceId = "sbi_deadline_runtime_state_mismatch";
      const gatewayBaseUrl = getGatewayProcess().baseUrl;

      await insertSandboxInstance({
        sandboxInstanceId,
        status: SandboxInstanceStatuses.RUNNING,
        providerSandboxId: "provider-runtime-state-mismatch",
      });
      await insertActiveDeadline({
        sandboxInstanceId,
        kind: SandboxInstanceDeadlineKinds.IDLE,
        ownerLeaseId: "own_deadline_runtime_state_mismatch",
        dueAt: MatchingDeadlineDueAt,
      });
      await expect(
        handleSandboxInstanceDeadline(
          createDeadlineExecutionContext({
            gatewayBaseUrl,
          }),
          {
            sandboxInstanceId,
            kind: SandboxInstanceDeadlineKinds.IDLE,
            ownerLeaseId: "own_deadline_runtime_state_mismatch",
            dueAt: MatchingDeadlineDueAt,
            generation: 1,
          },
        ),
      ).resolves.toEqual({
        sandboxInstanceId,
        kind: SandboxInstanceDeadlineKinds.IDLE,
        executed: false,
      });
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "executes an idle deadline when runtime-state ownership still matches",
    async () => {
      const sandboxInstanceId = "sbi_deadline_idle_executes";
      const gatewayBaseUrl = getGatewayProcess().baseUrl;

      await insertSandboxInstance({
        sandboxInstanceId,
        status: SandboxInstanceStatuses.RUNNING,
        providerSandboxId: "provider-idle-executes-missing",
      });

      const bootstrapToken = await mintValidBootstrapToken({
        sandboxInstanceId,
      });
      const bootstrapSocket = await connectBootstrapSocket({
        websocketBaseUrl: getGatewayProcess().websocketBaseUrl,
        sandboxInstanceId,
        token: bootstrapToken,
      });

      try {
        const ownerLeaseId = await waitForRuntimeStateOwnerLeaseId({
          gatewayBaseUrl,
          sandboxInstanceId,
        });

        await createDatabase()
          .insert(sandboxInstanceDeadlines)
          .values([
            {
              sandboxInstanceId,
              kind: SandboxInstanceDeadlineKinds.IDLE,
              ownerLeaseId,
              dueAt: MatchingDeadlineDueAt,
            },
            {
              sandboxInstanceId,
              kind: SandboxInstanceDeadlineKinds.DISCONNECT,
              ownerLeaseId: `owner_disconnect_${sandboxInstanceId}`,
              dueAt: MatchingDeadlineDueAt,
            },
          ]);

        await expect(
          handleSandboxInstanceDeadline(createDeadlineExecutionContext({ gatewayBaseUrl }), {
            sandboxInstanceId,
            kind: SandboxInstanceDeadlineKinds.IDLE,
            ownerLeaseId,
            dueAt: MatchingDeadlineDueAt,
            generation: 1,
          }),
        ).resolves.toEqual({
          sandboxInstanceId,
          kind: SandboxInstanceDeadlineKinds.IDLE,
          executed: true,
        });

        const sandboxInstance = await createDatabase().query.sandboxInstances.findFirst({
          columns: {
            status: true,
            stopReason: true,
          },
          where: (table, { eq }) => eq(table.id, sandboxInstanceId),
        });

        expect(sandboxInstance).toEqual({
          status: SandboxInstanceStatuses.STOPPED,
          stopReason: SandboxStopReasons.IDLE,
        });
        await expectDeadlinesCleared({
          sandboxInstanceId,
        });
      } finally {
        await closeWebSocket(bootstrapSocket);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it("returns executed false when the persisted deadline generation no longer matches", async () => {
    const sandboxInstanceId = "sbi_deadline_generation_mismatch";
    const gatewayBaseUrl = getGatewayProcess().baseUrl;

    await insertSandboxInstance({
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-generation-mismatch",
    });
    await insertActiveDeadline({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId: "own_deadline_generation_mismatch",
      dueAt: MatchingDeadlineDueAt,
      generation: 2,
    });
    await expect(
      handleSandboxInstanceDeadline(
        createDeadlineExecutionContext({
          gatewayBaseUrl,
        }),
        {
          sandboxInstanceId,
          kind: SandboxInstanceDeadlineKinds.IDLE,
          ownerLeaseId: "own_deadline_generation_mismatch",
          dueAt: MatchingDeadlineDueAt,
          generation: 1,
        },
      ),
    ).resolves.toEqual({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      executed: false,
    });
  });

  it("returns executed false when the persisted owner lease or dueAt no longer matches", async () => {
    const sandboxInstanceId = "sbi_deadline_payload_mismatch";
    const gatewayBaseUrl = getGatewayProcess().baseUrl;

    await insertSandboxInstance({
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-payload-mismatch",
    });
    await insertActiveDeadline({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId: "own_deadline_payload_mismatch",
      dueAt: MatchingDeadlineDueAt,
    });

    const runtimeConfig = createWorkerRuntimeConfig({
      gatewayBaseUrl,
    });
    const runtimeStateReader = createSandboxRuntimeStateReader({
      gatewayBaseUrl,
      serviceToken: InternalAuthServiceToken,
    });
    const sandboxAdapter = createSandboxRuntimeAdapter(runtimeConfig);

    await expect(
      handleSandboxInstanceDeadline(
        {
          config: runtimeConfig,
          db: createDatabase(),
          controlPlaneInternalClient: new ControlPlaneInternalClient({
            baseUrl: "http://127.0.0.1:5100",
            internalAuthServiceToken: InternalAuthServiceToken,
          }),
          sandboxAdapter,
          runtimeStateReader,
          clock: systemClock,
        },
        {
          sandboxInstanceId,
          kind: SandboxInstanceDeadlineKinds.IDLE,
          ownerLeaseId: "own_deadline_payload_mismatch_changed",
          dueAt: MatchingDeadlineDueAt,
          generation: 1,
        },
      ),
    ).resolves.toEqual({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      executed: false,
    });

    await expect(
      handleSandboxInstanceDeadline(
        {
          config: runtimeConfig,
          db: createDatabase(),
          controlPlaneInternalClient: new ControlPlaneInternalClient({
            baseUrl: "http://127.0.0.1:5100",
            internalAuthServiceToken: InternalAuthServiceToken,
          }),
          sandboxAdapter,
          runtimeStateReader,
          clock: systemClock,
        },
        {
          sandboxInstanceId,
          kind: SandboxInstanceDeadlineKinds.IDLE,
          ownerLeaseId: "own_deadline_payload_mismatch",
          dueAt: AlternateDeadlineDueAt,
          generation: 1,
        },
      ),
    ).resolves.toEqual({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      executed: false,
    });
  });

  it("returns executed false when the deadline row has already been cleared", async () => {
    const sandboxInstanceId = "sbi_deadline_cleared";
    const gatewayBaseUrl = getGatewayProcess().baseUrl;

    await createDatabase()
      .insert(sandboxInstances)
      .values({
        id: sandboxInstanceId,
        organizationId: `org_${sandboxInstanceId}`,
        sandboxProfileId: `sbp_${sandboxInstanceId}`,
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "system",
        startedById: `worker_${sandboxInstanceId}`,
        source: "dashboard",
        providerSandboxId: "provider-cleared",
      });
    await createDatabase().insert(sandboxInstanceDeadlines).values({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId: "own_deadline_cleared",
      dueAt: MatchingDeadlineDueAt,
      clearedAt: MatchingDeadlineDueAt,
    });
    await expect(
      handleSandboxInstanceDeadline(
        createDeadlineExecutionContext({
          gatewayBaseUrl,
        }),
        {
          sandboxInstanceId,
          kind: SandboxInstanceDeadlineKinds.IDLE,
          ownerLeaseId: "own_deadline_cleared",
          dueAt: MatchingDeadlineDueAt,
          generation: 1,
        },
      ),
    ).resolves.toEqual({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      executed: false,
    });
  });

  it(
    "executes a disconnect deadline and marks a missing provider runtime as failed",
    async () => {
      const sandboxInstanceId = "sbi_deadline_disconnect_executes";
      const gatewayBaseUrl = getGatewayProcess().baseUrl;

      await insertSandboxInstance({
        sandboxInstanceId,
        status: SandboxInstanceStatuses.RUNNING,
        providerSandboxId: "provider-disconnect-executes-missing",
      });
      await insertBothDeadlineKinds({
        sandboxInstanceId,
      });

      await expect(
        handleSandboxInstanceDeadline(createDeadlineExecutionContext({ gatewayBaseUrl }), {
          sandboxInstanceId,
          kind: SandboxInstanceDeadlineKinds.DISCONNECT,
          ownerLeaseId: `owner_disconnect_${sandboxInstanceId}`,
          dueAt: MatchingDeadlineDueAt,
          generation: 1,
        }),
      ).resolves.toEqual({
        sandboxInstanceId,
        kind: SandboxInstanceDeadlineKinds.DISCONNECT,
        executed: true,
      });

      const sandboxInstance = await createDatabase().query.sandboxInstances.findFirst({
        columns: {
          status: true,
          stopReason: true,
          failureCode: true,
        },
        where: (table, { eq }) => eq(table.id, sandboxInstanceId),
      });

      expect(sandboxInstance).toEqual({
        status: SandboxInstanceStatuses.FAILED,
        stopReason: SandboxStopReasons.FAILED,
        failureCode: "provider_runtime_missing",
      });
      await expectDeadlinesCleared({
        sandboxInstanceId,
      });
    },
    IntegrationTestTimeoutMs,
  );

  it("clears both deadline kinds when the stop workflow marks a sandbox instance stopped", async () => {
    const sandboxInstanceId = "sbi_deadline_stop_clears";

    await insertSandboxInstance({
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-stop-clears",
    });
    await insertBothDeadlineKinds({
      sandboxInstanceId,
    });

    await markSandboxInstanceStoppedDuringStop({
      db: createDatabase(),
      sandboxInstanceId,
      stopReason: "idle",
    });

    await expectDeadlinesCleared({
      sandboxInstanceId,
    });
  });

  it("clears both deadline kinds when start failure marks a sandbox instance failed", async () => {
    const sandboxInstanceId = "sbi_deadline_start_failure_clears";

    await insertSandboxInstance({
      sandboxInstanceId,
      status: SandboxInstanceStatuses.STARTING,
      providerSandboxId: "provider-start-failure-clears",
    });
    await insertBothDeadlineKinds({
      sandboxInstanceId,
    });

    await markSandboxInstanceFailedDuringStart(
      {
        db: createDatabase(),
      },
      {
        sandboxInstanceId,
        failureCode: "sandbox_init_failed",
        failureMessage: "sandbox initialization failed during integration test",
      },
    );

    await expectDeadlinesCleared({
      sandboxInstanceId,
    });
  });

  it("clears both deadline kinds when reconcile marks a sandbox instance stopped", async () => {
    const sandboxInstanceId = "sbi_deadline_reconcile_stop_clears";

    await insertSandboxInstance({
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-reconcile-stop-clears",
    });
    await insertBothDeadlineKinds({
      sandboxInstanceId,
    });

    await markSandboxInstanceStoppedDuringReconcile({
      db: createDatabase(),
      sandboxInstanceId,
      currentStatus: "running",
    });

    await expectDeadlinesCleared({
      sandboxInstanceId,
    });
  });

  it("clears both deadline kinds when reconcile marks a sandbox instance failed", async () => {
    const sandboxInstanceId = "sbi_deadline_reconcile_failure_clears";

    await insertSandboxInstance({
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "provider-reconcile-failure-clears",
    });
    await insertBothDeadlineKinds({
      sandboxInstanceId,
    });

    await markSandboxInstanceFailedDuringReconcile({
      db: createDatabase(),
      sandboxInstanceId,
      currentStatus: "running",
      failureCode: "provider_runtime_missing",
      failureMessage: "provider runtime missing during integration test",
    });

    await expectDeadlinesCleared({
      sandboxInstanceId,
    });
  });
});

import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  createDataPlaneDatabase,
  sandboxInstanceRuntimePlans,
  sandboxInstances,
  SandboxInstancePersistenceModes,
} from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import {
  createSandboxAdapter,
  createSandboxRuntimeControl,
  SandboxProvider,
  SandboxStorageBackend,
} from "@mistle/sandbox";
import { reserveAvailablePort, startPostgresWithPgBouncer } from "@mistle/test-harness";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import {
  createDataPlaneWorkerRuntimeConfig,
  loadDataPlaneWorkerConfig,
  requireDataPlaneWorkerGlobalConfig,
} from "../openworkflow/core/config.js";
import { markSandboxInstanceStarting } from "../openworkflow/resume-sandbox-instance/mark-sandbox-instance-starting.js";
import { persistSandboxInstanceComputeReplacement } from "../openworkflow/resume-sandbox-instance/persist-sandbox-instance-compute-replacement.js";
import { revertSandboxInstanceComputeReplacement } from "../openworkflow/resume-sandbox-instance/revert-sandbox-instance-compute-replacement.js";
import { attachSandboxStorage } from "../openworkflow/shared/attach-sandbox-storage.js";
import { prepareSandboxStorageForStart } from "../openworkflow/shared/prepare-sandbox-storage-for-start.js";
import { createSandboxStorageBackendAdapter } from "../openworkflow/shared/sandbox-storage/create-sandbox-storage-backend-adapter.js";
import { initializeSandboxRuntime } from "../openworkflow/start-sandbox-instance/initialize-sandbox-runtime.js";
import { markSandboxInstanceFailed } from "../openworkflow/start-sandbox-instance/mark-sandbox-instance-failed.js";
import { startSandbox } from "../openworkflow/start-sandbox-instance/start-sandbox.js";

const DockerSocketPath = "/var/run/docker.sock";
const IntegrationTestTimeoutMs = 300_000;
const SandboxBaseImageReference =
  "ghcr.io/mistlehq/sandbox-base@sha256:8a56c023b441511c09767761847bb4d137dbcc5ca497374406cecb29f63c1298";

type DatabaseStack = {
  directUrl: string;
  stop: () => Promise<void>;
};

function hasDockerReplacementIntegrationRuntime(): boolean {
  if (!existsSync(DockerSocketPath)) {
    return false;
  }

  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function runContainerCommand(input: { id: string; command: string[] }): {
  exitCode: number;
  output: string;
} {
  const result = spawnSync("docker", ["exec", input.id, ...input.command], {
    encoding: "utf8",
  });

  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout}${result.stderr}`.trimEnd(),
  };
}

function writeSandboxFile(input: { id: string; path: string; fileContents: string }): void {
  const result = runContainerCommand({
    id: input.id,
    command: ["sh", "-lc", `printf '%s' '${input.fileContents}' > '${input.path}'`],
  });

  if (result.exitCode !== 0) {
    throw new Error(`Failed to write sandbox file: ${result.output}`);
  }
}

function readSandboxFile(input: { id: string; path: string }): string {
  const result = runContainerCommand({
    id: input.id,
    command: ["cat", input.path],
  });

  if (result.exitCode !== 0) {
    throw new Error(`Failed to read sandbox file: ${result.output}`);
  }

  return result.output;
}

function resolveDockerHostForContainer(): string {
  if (process.platform === "darwin" || process.platform === "win32") {
    return "host.docker.internal";
  }

  const gateway = execFileSync(
    "docker",
    ["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"],
    {
      encoding: "utf8",
    },
  ).trim();

  if (gateway.length === 0) {
    throw new Error("Failed to resolve Docker bridge gateway for integration test.");
  }

  return gateway;
}

async function startBootstrapWebSocketServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const port = await reserveAvailablePort({ host: "127.0.0.1" });
  const sockets = new Set<WebSocket>();
  const server = new WebSocketServer({
    host: "0.0.0.0",
    port,
  });

  server.on("connection", (socket: WebSocket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("error", () => {
      return;
    });
  });

  const containerReachableHost = resolveDockerHostForContainer();

  return {
    baseUrl: `ws://${containerReachableHost}:${String(port)}/bootstrap`,
    close: async () => {
      for (const socket of sockets) {
        socket.terminate();
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

function createRuntimePlan() {
  return {
    sandboxProfileId: "sbp_pr15_replace_compute",
    version: 1,
    image: {
      source: "base" as const,
      imageRef: SandboxBaseImageReference,
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}

function createReplacementImage() {
  return {
    imageId: SandboxBaseImageReference,
    createdAt: new Date().toISOString(),
  };
}

function createWorkerRuntimeConfig(input: { websocketBaseUrl: string }) {
  const loadedConfig = loadDataPlaneWorkerConfig({
    NODE_ENV: "development",
    MISTLE_GLOBAL_TELEMETRY_ENABLED: "false",
    MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
    MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN: "integration-service-token",
    MISTLE_GLOBAL_SANDBOX_PROVIDER: "docker",
    MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE: SandboxBaseImageReference,
    MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL: input.websocketBaseUrl,
    MISTLE_GLOBAL_SANDBOX_INTERNAL_GATEWAY_WS_URL: input.websocketBaseUrl,
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
    MISTLE_GLOBAL_SANDBOX_STORAGE_BACKEND: "docker_volume",
    MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL: "postgresql://unused",
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL: "postgresql://unused",
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: "integration",
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY: "1",
    MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_BOOTSTRAP_TOKEN_TTL_SECONDS: "120",
    MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_EXCHANGE_TOKEN_TTL_SECONDS: "3600",
    MISTLE_APPS_DATA_PLANE_WORKER_RUNTIME_STATE_GATEWAY_BASE_URL: "http://127.0.0.1:5202",
    MISTLE_APPS_DATA_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL: "http://127.0.0.1:5100",
    MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL:
      "http://tokenizer-proxy/tokenizer-proxy/egress",
    MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH: DockerSocketPath,
    MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX: "it-pr15-",
  });
  requireDataPlaneWorkerGlobalConfig(
    loadedConfig,
    "replace persistent sandbox compute integration",
  );

  return createDataPlaneWorkerRuntimeConfig({
    app: loadedConfig.app,
    global: loadedConfig.global,
  });
}

function requireDockerSandboxConfig(input: {
  runtimeConfig: ReturnType<typeof createWorkerRuntimeConfig>;
}) {
  if (input.runtimeConfig.app.sandbox.docker === undefined) {
    throw new Error("Expected Docker sandbox config to be defined for integration test.");
  }

  return input.runtimeConfig.app.sandbox.docker;
}

const describeIfDockerReplacementIntegration = hasDockerReplacementIntegrationRuntime()
  ? describe
  : describe.skip;

describeIfDockerReplacementIntegration("replace persistent sandbox compute integration", () => {
  let databaseStack: DatabaseStack | undefined;
  let dbPool: Pool | undefined;

  function createDatabase() {
    if (dbPool === undefined) {
      throw new Error("Expected database pool to be initialized.");
    }

    return createDataPlaneDatabase(dbPool);
  }

  beforeAll(async () => {
    const postgresStack = await startPostgresWithPgBouncer();
    databaseStack = {
      directUrl: postgresStack.directUrl,
      stop: async () => {
        await postgresStack.stop();
      },
    };

    await runDataPlaneMigrations({
      connectionString: databaseStack.directUrl,
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      schemaName: "data_plane",
      migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
    });

    dbPool = new Pool({
      connectionString: databaseStack.directUrl,
    });
  }, IntegrationTestTimeoutMs);

  afterAll(async () => {
    await dbPool?.end();
    await databaseStack?.stop();
  });

  beforeEach(async () => {
    await createDatabase().delete(sandboxInstanceRuntimePlans);
    await createDatabase().delete(sandboxInstances);
  });

  afterEach(() => {
    return;
  });

  it(
    "replaces missing Docker compute against the existing persistent volume and increments compute generation",
    async () => {
      const bootstrapWsServer = await startBootstrapWebSocketServer();
      const runtimeConfig = createWorkerRuntimeConfig({
        websocketBaseUrl: bootstrapWsServer.baseUrl,
      });
      const dockerSandboxConfig = requireDockerSandboxConfig({ runtimeConfig });
      const db = createDatabase();
      const sandboxAdapter = createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: dockerSandboxConfig,
      });
      const sandboxRuntimeControl = createSandboxRuntimeControl({
        provider: SandboxProvider.DOCKER,
        docker: dockerSandboxConfig,
      });
      const controlPlaneInternalClient = new ControlPlaneInternalClient({
        baseUrl: "http://127.0.0.1:1",
        internalAuthServiceToken: "unused",
      });

      const sandboxInstanceId = `sbi_pr15_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const organizationId = `org_pr15_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const runtimePlan = createRuntimePlan();
      const storageBackendAdapter = createSandboxStorageBackendAdapter({
        db,
        controlPlaneInternalClient,
        workerConfig: runtimeConfig.app,
        runtimeProvider: SandboxProvider.DOCKER,
        storageBackend: SandboxStorageBackend.DOCKER_VOLUME,
      });

      await db.insert(sandboxInstances).values({
        id: sandboxInstanceId,
        organizationId,
        sandboxProfileId: runtimePlan.sandboxProfileId,
        sandboxProfileVersion: runtimePlan.version,
        runtimeProvider: SandboxProvider.DOCKER,
        providerSandboxId: null,
        computeGeneration: 1,
        status: "stopped",
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        startedByKind: "system",
        startedById: "worker_pr15_replace_compute",
        source: "dashboard",
      });
      await db.insert(sandboxInstanceRuntimePlans).values({
        sandboxInstanceId,
        revision: 1,
        compiledRuntimePlan: runtimePlan,
        compiledFromProfileId: runtimePlan.sandboxProfileId,
        compiledFromProfileVersion: runtimePlan.version,
      });

      const storageRecord = await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });
      const resolvedStorage = await storageBackendAdapter.resolveAttachment({
        organizationId,
        sandboxInstanceId,
      });

      const initialSandbox = await startSandbox(
        {
          config: runtimeConfig,
          sandboxAdapter,
        },
        {
          sandboxInstanceId,
          image: {
            imageId: SandboxBaseImageReference,
            createdAt: new Date().toISOString(),
          },
          storagePreparation: await sandboxAdapter.prepareStorageForStart({
            sandboxInstanceId,
            image: {
              provider: SandboxProvider.DOCKER,
              imageId: SandboxBaseImageReference,
              createdAt: new Date().toISOString(),
            },
            storage: resolvedStorage,
          }),
        },
      );

      const durableFilePath = "/root/pr15-durable.txt";
      const durableFileContents = "persistent-compute-replacement";
      writeSandboxFile({
        id: initialSandbox.providerSandboxId,
        path: durableFilePath,
        fileContents: durableFileContents,
      });
      await sandboxAdapter.destroy({ id: initialSandbox.providerSandboxId });
      await markSandboxInstanceStarting({
        db,
        sandboxInstanceId,
      });

      const replacementImage = createReplacementImage();
      const replacementStoragePreparation = await prepareSandboxStorageForStart(
        {
          db,
          controlPlaneInternalClient,
          workerConfig: runtimeConfig.app,
          configuredSandboxProvider: runtimeConfig.sandbox.provider,
          sandboxAdapter,
          storageBackend: runtimeConfig.sandbox.storage?.backend,
        },
        {
          organizationId,
          sandboxInstanceId,
          image: replacementImage,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          runtimeProvider: SandboxProvider.DOCKER,
        },
      );

      const replacedSandbox = await startSandbox(
        {
          config: runtimeConfig,
          sandboxAdapter,
        },
        {
          sandboxInstanceId,
          image: replacementImage,
          storagePreparation: replacementStoragePreparation,
        },
      );

      await persistSandboxInstanceComputeReplacement(
        {
          db,
        },
        {
          sandboxInstanceId,
          providerSandboxId: replacedSandbox.providerSandboxId,
          previousComputeGeneration: 1,
        },
      );

      await attachSandboxStorage(
        {
          db,
          controlPlaneInternalClient,
          workerConfig: runtimeConfig.app,
          configuredSandboxProvider: runtimeConfig.sandbox.provider,
          sandboxAdapter,
          storageBackend: runtimeConfig.sandbox.storage?.backend,
        },
        {
          organizationId,
          sandboxInstanceId,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          runtimeProvider: SandboxProvider.DOCKER,
          providerSandboxId: replacedSandbox.providerSandboxId,
          lifecycle: "start",
        },
      );

      await initializeSandboxRuntime(
        {
          config: runtimeConfig,
          sandboxRuntimeControl,
        },
        {
          sandboxInstanceId,
          providerSandboxId: replacedSandbox.providerSandboxId,
          startupMode: "new",
          runtimePlan,
        },
      );

      expect(replacedSandbox.providerSandboxId).not.toBe(initialSandbox.providerSandboxId);
      expect(
        readSandboxFile({ id: replacedSandbox.providerSandboxId, path: durableFilePath }),
      ).toBe(durableFileContents);

      const persistedSandboxInstance = await db.query.sandboxInstances.findFirst({
        columns: {
          providerSandboxId: true,
          computeGeneration: true,
          status: true,
        },
        where: (table, { eq }) => eq(table.id, sandboxInstanceId),
      });
      expect(persistedSandboxInstance).toEqual({
        providerSandboxId: replacedSandbox.providerSandboxId,
        computeGeneration: 2,
        status: "starting",
      });

      await sandboxAdapter.destroy({ id: replacedSandbox.providerSandboxId });
      await storageBackendAdapter.deprovision({
        organizationId,
        sandboxInstanceId,
      });
      await bootstrapWsServer.close();

      expect(storageRecord.backend).toBe(SandboxStorageBackend.DOCKER_VOLUME);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "compensates replacement compute when replacement fails after persisting the new compute id",
    async () => {
      const bootstrapWsServer = await startBootstrapWebSocketServer();
      const runtimeConfig = createWorkerRuntimeConfig({
        websocketBaseUrl: bootstrapWsServer.baseUrl,
      });
      const dockerSandboxConfig = requireDockerSandboxConfig({ runtimeConfig });
      const db = createDatabase();
      const sandboxAdapter = createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: dockerSandboxConfig,
      });
      const sandboxRuntimeControl = createSandboxRuntimeControl({
        provider: SandboxProvider.DOCKER,
        docker: dockerSandboxConfig,
      });
      const controlPlaneInternalClient = new ControlPlaneInternalClient({
        baseUrl: "http://127.0.0.1:1",
        internalAuthServiceToken: "unused",
      });

      const sandboxInstanceId = `sbi_pr15_fail_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const organizationId = `org_pr15_fail_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const storageBackendAdapter = createSandboxStorageBackendAdapter({
        db,
        controlPlaneInternalClient,
        workerConfig: runtimeConfig.app,
        runtimeProvider: SandboxProvider.DOCKER,
        storageBackend: SandboxStorageBackend.DOCKER_VOLUME,
      });
      const runtimePlan = {
        ...createRuntimePlan(),
        workspaceSources: [
          {
            sourceKind: "git-clone" as const,
            resourceKind: "repository" as const,
            path: "/root/does-not-exist",
            originUrl:
              "https://github.com/mistlehq/this-repository-does-not-exist-for-pr15-replacement-test.git",
          },
        ],
      };

      await db.insert(sandboxInstances).values({
        id: sandboxInstanceId,
        organizationId,
        sandboxProfileId: runtimePlan.sandboxProfileId,
        sandboxProfileVersion: runtimePlan.version,
        runtimeProvider: SandboxProvider.DOCKER,
        providerSandboxId: null,
        computeGeneration: 1,
        status: "stopped",
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        startedByKind: "system",
        startedById: "worker_pr15_replace_compute_failure",
        source: "dashboard",
      });
      await db.insert(sandboxInstanceRuntimePlans).values({
        sandboxInstanceId,
        revision: 1,
        compiledRuntimePlan: runtimePlan,
        compiledFromProfileId: runtimePlan.sandboxProfileId,
        compiledFromProfileVersion: runtimePlan.version,
      });

      await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });
      await markSandboxInstanceStarting({
        db,
        sandboxInstanceId,
      });

      try {
        const replacementImage = createReplacementImage();
        const replacementStoragePreparation = await prepareSandboxStorageForStart(
          {
            db,
            controlPlaneInternalClient,
            workerConfig: runtimeConfig.app,
            configuredSandboxProvider: runtimeConfig.sandbox.provider,
            sandboxAdapter,
            storageBackend: runtimeConfig.sandbox.storage?.backend,
          },
          {
            organizationId,
            sandboxInstanceId,
            image: replacementImage,
            persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
            runtimeProvider: SandboxProvider.DOCKER,
          },
        );

        const replacementSandbox = await startSandbox(
          {
            config: runtimeConfig,
            sandboxAdapter,
          },
          {
            sandboxInstanceId,
            image: replacementImage,
            storagePreparation: replacementStoragePreparation,
          },
        );

        const persistedReplacement = await persistSandboxInstanceComputeReplacement(
          {
            db,
          },
          {
            sandboxInstanceId,
            providerSandboxId: replacementSandbox.providerSandboxId,
            previousComputeGeneration: 1,
          },
        );

        await attachSandboxStorage(
          {
            db,
            controlPlaneInternalClient,
            workerConfig: runtimeConfig.app,
            configuredSandboxProvider: runtimeConfig.sandbox.provider,
            sandboxAdapter,
            storageBackend: runtimeConfig.sandbox.storage?.backend,
          },
          {
            organizationId,
            sandboxInstanceId,
            persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
            runtimeProvider: SandboxProvider.DOCKER,
            providerSandboxId: replacementSandbox.providerSandboxId,
            lifecycle: "start",
          },
        );

        await expect(
          initializeSandboxRuntime(
            {
              config: runtimeConfig,
              sandboxRuntimeControl,
            },
            {
              sandboxInstanceId,
              providerSandboxId: replacementSandbox.providerSandboxId,
              startupMode: "new",
              runtimePlan,
            },
          ),
        ).rejects.toThrow(/failed to submit sandbox init request/i);

        await revertSandboxInstanceComputeReplacement(
          {
            db,
          },
          {
            sandboxInstanceId,
            replacementProviderSandboxId: replacementSandbox.providerSandboxId,
            replacementComputeGeneration: persistedReplacement.computeGeneration,
            previousProviderSandboxId: null,
            previousComputeGeneration: 1,
          },
        );

        await sandboxAdapter.destroy({
          id: replacementSandbox.providerSandboxId,
        });

        await markSandboxInstanceFailed(
          {
            db,
          },
          {
            sandboxInstanceId,
            failureCode: "resume_sandbox_failed",
            failureMessage: "Failed to replace missing sandbox compute during resume.",
          },
        );

        const persistedSandboxInstance = await db.query.sandboxInstances.findFirst({
          columns: {
            providerSandboxId: true,
            computeGeneration: true,
            status: true,
            failureCode: true,
          },
          where: (table, { eq }) => eq(table.id, sandboxInstanceId),
        });
        expect(persistedSandboxInstance).toEqual({
          providerSandboxId: null,
          computeGeneration: 1,
          status: "failed",
          failureCode: "resume_sandbox_failed",
        });

        const replacementContainerIds = execFileSync(
          "docker",
          ["ps", "-aq", "--filter", `name=^it-pr15-${sandboxInstanceId}$`],
          {
            encoding: "utf8",
          },
        )
          .trim()
          .split("\n")
          .filter((value) => value.length > 0);

        expect(replacementContainerIds).toEqual([]);
      } finally {
        await storageBackendAdapter.deprovision({
          organizationId,
          sandboxInstanceId,
        });
        await bootstrapWsServer.close();
      }
    },
    IntegrationTestTimeoutMs,
  );
});

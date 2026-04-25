import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getLocalPreparedRuntimeSandboxBaseImageRef } from "@mistle/config";
import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  createControlPlaneDatabase,
  organizations,
  sandboxProfileVersionSnapshotJobs,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  sandboxProfiles,
  sandboxProfileVersions,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import {
  createDataPlaneDatabase,
  sandboxInstanceRuntimePlans,
  sandboxInstances,
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStarterKinds,
  SandboxInstanceStatuses,
  SandboxStopReasons,
} from "@mistle/db/data-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { ensureCommitSignBinary } from "../../control-plane-api/integration/helpers/commit-sign.js";
import { logger as dataPlaneWorkerLogger } from "../logger.js";
import {
  createDataPlaneWorkerRuntimeConfig,
  loadDataPlaneWorkerConfig,
  requireDataPlaneWorkerGlobalConfig,
} from "../openworkflow/core/config.js";
import {
  executeMaterializeSandboxProfileVersionSnapshot,
  type SnapshotWorkflowStepRunner,
} from "../openworkflow/materialize-sandbox-profile-version-snapshot/workflow.js";
import { startControlPlaneApiProcess } from "./helpers/control-plane-api.js";

const DockerSocketPath = "/var/run/docker.sock";
const IntegrationTestTimeoutMs = 300_000;
const InternalAuthServiceToken = "integration-service-token";
const SandboxBaseImageReference = getLocalPreparedRuntimeSandboxBaseImageRef();
const SnapshotMarkerPath = "/tmp/mistle-snapshot-marker.txt";
const RepoRootPath = fileURLToPath(new URL("../../..", import.meta.url));

type DatabaseStack = {
  directUrl: string;
  stop: () => Promise<void>;
};

type StartedControlPlaneApiProcess = Awaited<ReturnType<typeof startControlPlaneApiProcess>>;

type StartedBootstrapWebSocketServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

function hasDockerSnapshotIntegrationRuntime(): boolean {
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

function dockerImageExists(imageReference: string): boolean {
  try {
    execFileSync("docker", ["image", "inspect", imageReference], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function ensureLocalSandboxBaseImage(): void {
  if (dockerImageExists(SandboxBaseImageReference)) {
    return;
  }

  execFileSync(
    "docker",
    [
      "build",
      "--target",
      "sandbox-base-system-tests",
      "-f",
      "packages/sandboxd/Dockerfile",
      "-t",
      SandboxBaseImageReference,
      ".",
    ],
    {
      cwd: RepoRootPath,
      stdio: "inherit",
    },
  );
}

function getControlPlaneDb(pool: Pool) {
  return createControlPlaneDatabase(pool);
}

function getDataPlaneDb(pool: Pool) {
  return createDataPlaneDatabase(pool);
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

async function removeDockerImage(input: { imageId: string }): Promise<void> {
  execFileSync("docker", ["image", "rm", "--force", input.imageId], {
    cwd: RepoRootPath,
    stdio: "ignore",
  });
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

async function startBootstrapWebSocketServer(): Promise<StartedBootstrapWebSocketServer> {
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

  return {
    baseUrl: `ws://${resolveDockerHostForContainer()}:${String(port)}/bootstrap`,
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

function createWorkerRuntimeConfig(input: {
  databaseUrl: string;
  controlPlaneApiBaseUrl: string;
  websocketBaseUrl: string;
}) {
  const loadedConfig = loadDataPlaneWorkerConfig({
    NODE_ENV: "development",
    MISTLE_GLOBAL_TELEMETRY_ENABLED: "false",
    MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
    MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN: InternalAuthServiceToken,
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
    MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL: input.databaseUrl,
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL: input.databaseUrl,
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: "snapshot-integration",
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
    MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY: "1",
    MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_BOOTSTRAP_TOKEN_TTL_SECONDS: "120",
    MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_EXCHANGE_TOKEN_TTL_SECONDS: "3600",
    MISTLE_APPS_DATA_PLANE_WORKER_RUNTIME_STATE_GATEWAY_BASE_URL: "http://127.0.0.1:5202",
    MISTLE_APPS_DATA_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL: input.controlPlaneApiBaseUrl,
    MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL:
      "http://tokenizer-proxy/tokenizer-proxy/egress",
    MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH: DockerSocketPath,
    MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX: "it-pr4-snapshot-",
  });
  requireDataPlaneWorkerGlobalConfig(loadedConfig, "snapshot materialization integration");

  return createDataPlaneWorkerRuntimeConfig({
    app: loadedConfig.app,
    global: loadedConfig.global,
  });
}

function createInlineStepApi(): SnapshotWorkflowStepRunner {
  return {
    run: async (_config, fn) => await fn(),
  };
}

const describeIfDockerSnapshotIntegration = hasDockerSnapshotIntegrationRuntime()
  ? describe
  : describe.skip;

describeIfDockerSnapshotIntegration("snapshot materialization workflow integration", () => {
  let databaseStack: DatabaseStack | undefined;
  let dbPool: Pool | undefined;
  let controlPlaneApi: StartedControlPlaneApiProcess | undefined;
  let commitSignBinaryPath: string | undefined;
  let sandboxBaseImageId: string | undefined;

  function requireDbPool(): Pool {
    if (dbPool === undefined) {
      throw new Error("Expected integration database pool to be initialized.");
    }

    return dbPool;
  }

  function requireControlPlaneApi(): StartedControlPlaneApiProcess {
    if (controlPlaneApi === undefined) {
      throw new Error("Expected integration control-plane API to be started.");
    }

    return controlPlaneApi;
  }

  function requireSandboxBaseImageId(): string {
    if (sandboxBaseImageId === undefined) {
      throw new Error("Expected local sandbox base image id to be initialized.");
    }

    return sandboxBaseImageId;
  }

  beforeAll(async () => {
    ensureLocalSandboxBaseImage();
    sandboxBaseImageId = execFileSync(
      "docker",
      ["image", "inspect", SandboxBaseImageReference, "--format", "{{.Id}}"],
      {
        cwd: RepoRootPath,
        encoding: "utf8",
      },
    ).trim();

    const postgresStack = await startPostgresWithPgBouncer();
    databaseStack = {
      directUrl: postgresStack.directUrl,
      stop: async () => {
        await postgresStack.stop();
      },
    };

    await runControlPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: "control_plane",
      migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
    });
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

    commitSignBinaryPath = await ensureCommitSignBinary();
    const controlPlaneApiPort = await reserveAvailablePort({ host: "127.0.0.1" });
    const dataPlaneApiPort = await reserveAvailablePort({ host: "127.0.0.1" });
    controlPlaneApi = await startControlPlaneApiProcess({
      host: "127.0.0.1",
      port: controlPlaneApiPort,
      databaseUrl: databaseStack.directUrl,
      dataPlaneApiBaseUrl: `http://127.0.0.1:${String(dataPlaneApiPort)}`,
      workflowNamespaceId: "snapshot-integration",
      internalAuthServiceToken: InternalAuthServiceToken,
      sandboxStorageBackend: SandboxStorageBackend.DOCKER_VOLUME,
      commitSignBinaryPath,
    });
  }, IntegrationTestTimeoutMs);

  afterAll(async () => {
    await controlPlaneApi?.stop();
    await dbPool?.end();
    await databaseStack?.stop();
  });

  beforeEach(async () => {
    const pool = requireDbPool();
    const controlPlaneDb = getControlPlaneDb(pool);
    const dataPlaneDb = getDataPlaneDb(pool);

    await dataPlaneDb.delete(sandboxInstanceRuntimePlans);
    await dataPlaneDb.delete(sandboxInstances);
    await controlPlaneDb.delete(sandboxProfileVersionSnapshotJobs);
    await controlPlaneDb.delete(sandboxProfileVersions);
    await controlPlaneDb.delete(sandboxProfiles);
    await controlPlaneDb.delete(organizations);
  });

  it(
    "returns without work when another workflow run already owns the snapshot job",
    async () => {
      const pool = requireDbPool();
      const controlPlaneDb = getControlPlaneDb(pool);
      const dataPlaneDb = getDataPlaneDb(pool);
      const controlPlaneInternalClient = new ControlPlaneInternalClient({
        baseUrl: requireControlPlaneApi().baseUrl,
        internalAuthServiceToken: InternalAuthServiceToken,
      });
      const sandboxRuntimeControl = createSandboxRuntimeControl({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: DockerSocketPath,
        },
      });

      const organizationId = `org_snapshot_claim_loss_${randomUUID()}`;
      const sandboxProfileId = `sbp_snapshot_claim_loss_${randomUUID()}`;
      const snapshotJobId = `ssj_snapshot_claim_loss_${randomUUID()}`;
      const sandboxInstanceId = `sbi_snapshot_claim_loss_${randomUUID()}`;
      const workflowRunId = `wr_snapshot_claim_loss_${randomUUID()}`;
      const existingWorkflowRunId = `wr_snapshot_claim_loss_existing_${randomUUID()}`;
      const marker = `claim-loss-${randomUUID()}`;

      await controlPlaneDb.insert(organizations).values({
        id: organizationId,
        name: "Snapshot Claim Loss Org",
        slug: `snapshot-claim-loss-${randomUUID()}`,
      });
      await controlPlaneDb.insert(sandboxProfiles).values({
        id: sandboxProfileId,
        organizationId,
        displayName: "Snapshot Claim Loss Profile",
      });
      await controlPlaneDb.insert(sandboxProfileVersions).values({
        sandboxProfileId,
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: new Date().toISOString(),
        setupScript: `printf '%s' '${marker}' > '${SnapshotMarkerPath}'`,
      });
      await controlPlaneDb.insert(sandboxProfileVersionSnapshotJobs).values({
        id: snapshotJobId,
        sandboxProfileId,
        sandboxProfileVersion: 1,
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.RUNNING,
        workflowRunId: existingWorkflowRunId,
        startedAt: new Date().toISOString(),
      });

      const bootstrapServer = await startBootstrapWebSocketServer();
      try {
        const runtimeConfig = createWorkerRuntimeConfig({
          databaseUrl: databaseStack!.directUrl,
          controlPlaneApiBaseUrl: requireControlPlaneApi().baseUrl,
          websocketBaseUrl: bootstrapServer.baseUrl,
        });

        const output = await executeMaterializeSandboxProfileVersionSnapshot({
          ctx: {
            config: runtimeConfig,
            controlPlaneInternalClient,
            db: dataPlaneDb,
            logger: dataPlaneWorkerLogger,
            sandboxAdapter: createSandboxAdapter({
              provider: SandboxProvider.DOCKER,
              docker: {
                socketPath: DockerSocketPath,
              },
            }),
            sandboxRuntimeControl,
          },
          workflowInput: {
            snapshotJobId,
            sandboxInstanceId,
            organizationId,
            sandboxProfileId,
            sandboxProfileVersion: 1,
            image: {
              imageId: requireSandboxBaseImageId(),
              createdAt: new Date().toISOString(),
              kind: "base",
            },
          },
          workflowRunId,
          step: createInlineStepApi(),
        });

        expect(output).toEqual({
          snapshotJobId,
          sandboxInstanceId,
          claimed: false,
        });

        const persistedJob = await controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst(
          {
            where: (table, { eq }) => eq(table.id, snapshotJobId),
          },
        );

        expect(persistedJob).toMatchObject({
          id: snapshotJobId,
          state: SandboxProfileVersionSnapshotJobStates.RUNNING,
          workflowRunId: existingWorkflowRunId,
        });

        const persistedSandboxInstance = await dataPlaneDb.query.sandboxInstances.findFirst({
          where: (table, { eq }) => eq(table.id, sandboxInstanceId),
        });

        expect(persistedSandboxInstance).toBeUndefined();
      } finally {
        await bootstrapServer.close();
        await sandboxRuntimeControl.close();
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "captures a snapshot for a queued job and persists the hidden snapshot sandbox lifecycle",
    async () => {
      const pool = requireDbPool();
      const controlPlaneDb = getControlPlaneDb(pool);
      const dataPlaneDb = getDataPlaneDb(pool);
      const controlPlaneInternalClient = new ControlPlaneInternalClient({
        baseUrl: requireControlPlaneApi().baseUrl,
        internalAuthServiceToken: InternalAuthServiceToken,
      });
      const sandboxAdapter = createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: DockerSocketPath,
        },
      });
      const sandboxRuntimeControl = createSandboxRuntimeControl({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: DockerSocketPath,
        },
      });

      const organizationId = `org_snapshot_success_${randomUUID()}`;
      const sandboxProfileId = `sbp_snapshot_success_${randomUUID()}`;
      const snapshotJobId = `ssj_snapshot_success_${randomUUID()}`;
      const sandboxInstanceId = `sbi_snapshot_success_${randomUUID()}`;
      const workflowRunId = `wr_snapshot_success_${randomUUID()}`;
      const marker = `snapshot-ready-${randomUUID()}`;
      let restoredSandboxId: string | undefined;
      let snapshotImageId: string | undefined;

      await controlPlaneDb.insert(organizations).values({
        id: organizationId,
        name: "Snapshot Success Org",
        slug: `snapshot-success-${randomUUID()}`,
      });
      await controlPlaneDb.insert(sandboxProfiles).values({
        id: sandboxProfileId,
        organizationId,
        displayName: "Snapshot Success Profile",
      });
      await controlPlaneDb.insert(sandboxProfileVersions).values({
        sandboxProfileId,
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: new Date().toISOString(),
        setupScript: `printf '%s' '${marker}' > '${SnapshotMarkerPath}'`,
      });
      await controlPlaneDb.insert(sandboxProfileVersionSnapshotJobs).values({
        id: snapshotJobId,
        sandboxProfileId,
        sandboxProfileVersion: 1,
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
      });

      const bootstrapServer = await startBootstrapWebSocketServer();
      try {
        const runtimeConfig = createWorkerRuntimeConfig({
          databaseUrl: databaseStack!.directUrl,
          controlPlaneApiBaseUrl: requireControlPlaneApi().baseUrl,
          websocketBaseUrl: bootstrapServer.baseUrl,
        });

        const output = await executeMaterializeSandboxProfileVersionSnapshot({
          ctx: {
            config: runtimeConfig,
            controlPlaneInternalClient,
            db: dataPlaneDb,
            logger: dataPlaneWorkerLogger,
            sandboxAdapter,
            sandboxRuntimeControl,
          },
          workflowInput: {
            snapshotJobId,
            sandboxInstanceId,
            organizationId,
            sandboxProfileId,
            sandboxProfileVersion: 1,
            image: {
              imageId: requireSandboxBaseImageId(),
              createdAt: new Date().toISOString(),
              kind: "base",
            },
          },
          workflowRunId,
          step: createInlineStepApi(),
        });

        expect(output.claimed).toBe(true);
        expect(output.snapshotJobId).toBe(snapshotJobId);
        expect(output.sandboxInstanceId).toBe(sandboxInstanceId);
        expect(output.image?.provider).toBe(SandboxProvider.DOCKER);
        expect(output.image?.imageId).toBeTruthy();

        if (output.image === undefined) {
          throw new Error("Expected snapshot workflow to return a captured image.");
        }

        snapshotImageId = output.image.imageId;

        const persistedJob = await controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst(
          {
            where: (table, { eq }) => eq(table.id, snapshotJobId),
          },
        );

        expect(persistedJob).toMatchObject({
          id: snapshotJobId,
          state: SandboxProfileVersionSnapshotJobStates.SUCCEEDED,
          workflowRunId,
          candidateImageProvider: SandboxProvider.DOCKER,
          candidateImageId: output.image.imageId,
        });
        expect(persistedJob?.startedAt).not.toBeNull();
        expect(persistedJob?.finishedAt).not.toBeNull();

        const persistedSandboxInstance = await dataPlaneDb.query.sandboxInstances.findFirst({
          where: (table, { eq }) => eq(table.id, sandboxInstanceId),
        });

        expect(persistedSandboxInstance).toMatchObject({
          id: sandboxInstanceId,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
          status: SandboxInstanceStatuses.STOPPED,
          startedByKind: SandboxInstanceStarterKinds.SYSTEM,
          startedById: snapshotJobId,
          source: SandboxInstanceSources.SYSTEM,
          purpose: SandboxInstancePurposes.SNAPSHOT,
          persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
          stopReason: SandboxStopReasons.SYSTEM,
        });
        expect(persistedSandboxInstance?.providerSandboxId).toBeTruthy();
        expect(persistedSandboxInstance?.startedAt).not.toBeNull();
        expect(persistedSandboxInstance?.stoppedAt).not.toBeNull();

        const persistedRuntimePlan = await dataPlaneDb.query.sandboxInstanceRuntimePlans.findFirst({
          where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
        });

        expect(persistedRuntimePlan).toMatchObject({
          sandboxInstanceId,
          compiledFromProfileId: sandboxProfileId,
          compiledFromProfileVersion: 1,
          revision: 1,
        });

        const restoredSandbox = await sandboxAdapter.start({
          image: output.image,
        });
        restoredSandboxId = restoredSandbox.id;

        const restoredMarker = readSandboxFile({
          id: restoredSandbox.id,
          path: SnapshotMarkerPath,
        });
        expect(restoredMarker).toBe(marker);
      } finally {
        await bootstrapServer.close();
        await sandboxRuntimeControl.close();

        if (restoredSandboxId !== undefined) {
          await sandboxAdapter.destroy({
            id: restoredSandboxId,
          });
        }

        if (snapshotImageId !== undefined) {
          await removeDockerImage({
            imageId: snapshotImageId,
          }).catch(() => undefined);
        }
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "marks the snapshot job and hidden sandbox instance as failed when runtime initialization fails",
    async () => {
      const pool = requireDbPool();
      const controlPlaneDb = getControlPlaneDb(pool);
      const dataPlaneDb = getDataPlaneDb(pool);
      const controlPlaneInternalClient = new ControlPlaneInternalClient({
        baseUrl: requireControlPlaneApi().baseUrl,
        internalAuthServiceToken: InternalAuthServiceToken,
      });
      const sandboxAdapter = createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: DockerSocketPath,
        },
      });
      const sandboxRuntimeControl = createSandboxRuntimeControl({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: DockerSocketPath,
        },
      });

      const organizationId = `org_snapshot_init_failure_${randomUUID()}`;
      const sandboxProfileId = `sbp_snapshot_init_failure_${randomUUID()}`;
      const snapshotJobId = `ssj_snapshot_init_failure_${randomUUID()}`;
      const sandboxInstanceId = `sbi_snapshot_init_failure_${randomUUID()}`;
      const workflowRunId = `wr_snapshot_init_failure_${randomUUID()}`;

      await controlPlaneDb.insert(organizations).values({
        id: organizationId,
        name: "Snapshot Init Failure Org",
        slug: `snapshot-init-failure-${randomUUID()}`,
      });
      await controlPlaneDb.insert(sandboxProfiles).values({
        id: sandboxProfileId,
        organizationId,
        displayName: "Snapshot Init Failure Profile",
      });
      await controlPlaneDb.insert(sandboxProfileVersions).values({
        sandboxProfileId,
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: new Date().toISOString(),
        setupScript: "exit 17",
      });
      await controlPlaneDb.insert(sandboxProfileVersionSnapshotJobs).values({
        id: snapshotJobId,
        sandboxProfileId,
        sandboxProfileVersion: 1,
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
      });

      const bootstrapServer = await startBootstrapWebSocketServer();
      try {
        const runtimeConfig = createWorkerRuntimeConfig({
          databaseUrl: databaseStack!.directUrl,
          controlPlaneApiBaseUrl: requireControlPlaneApi().baseUrl,
          websocketBaseUrl: bootstrapServer.baseUrl,
        });

        await expect(
          executeMaterializeSandboxProfileVersionSnapshot({
            ctx: {
              config: runtimeConfig,
              controlPlaneInternalClient,
              db: dataPlaneDb,
              logger: dataPlaneWorkerLogger,
              sandboxAdapter,
              sandboxRuntimeControl,
            },
            workflowInput: {
              snapshotJobId,
              sandboxInstanceId,
              organizationId,
              sandboxProfileId,
              sandboxProfileVersion: 1,
              image: {
                imageId: requireSandboxBaseImageId(),
                createdAt: new Date().toISOString(),
                kind: "base",
              },
            },
            workflowRunId,
            step: createInlineStepApi(),
          }),
        ).rejects.toThrow("Failed to initialize snapshot sandbox runtime.");

        const persistedJob = await controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst(
          {
            where: (table, { eq }) => eq(table.id, snapshotJobId),
          },
        );

        expect(persistedJob).toMatchObject({
          id: snapshotJobId,
          state: SandboxProfileVersionSnapshotJobStates.FAILED,
          workflowRunId,
          errorCode: "snapshot_sandbox_init_failed",
          candidateImageProvider: null,
          candidateImageId: null,
        });
        expect(persistedJob?.startedAt).not.toBeNull();
        expect(persistedJob?.finishedAt).not.toBeNull();
        expect(persistedJob?.errorMessage).toContain(
          "Failed to initialize snapshot sandbox runtime.",
        );

        const persistedSandboxInstance = await dataPlaneDb.query.sandboxInstances.findFirst({
          where: (table, { eq }) => eq(table.id, sandboxInstanceId),
        });

        expect(persistedSandboxInstance).toMatchObject({
          id: sandboxInstanceId,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
          status: SandboxInstanceStatuses.FAILED,
          startedByKind: SandboxInstanceStarterKinds.SYSTEM,
          startedById: snapshotJobId,
          source: SandboxInstanceSources.SYSTEM,
          purpose: SandboxInstancePurposes.SNAPSHOT,
          persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
          stopReason: SandboxStopReasons.FAILED,
          failureCode: "snapshot_sandbox_init_failed",
        });
        expect(persistedSandboxInstance?.failedAt).not.toBeNull();
        expect(persistedSandboxInstance?.failureMessage).toContain(
          "Failed to initialize snapshot sandbox runtime.",
        );
      } finally {
        await bootstrapServer.close();
        await sandboxRuntimeControl.close();
      }
    },
    IntegrationTestTimeoutMs,
  );
});

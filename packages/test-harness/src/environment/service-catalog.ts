import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { CONTROL_PLANE_SCHEMA_NAME } from "@mistle/db/control-plane";
import { DATA_PLANE_SCHEMA_NAME } from "@mistle/db/data-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { systemSleeper } from "@mistle/time";
import { BackendPostgres } from "openworkflow/postgres";
import { Client } from "pg";
import { createClient } from "redis";
import { GenericContainer } from "testcontainers";

import { startControlPlaneApi } from "../apps/control-plane-api.js";
import { startControlPlaneWorker } from "../apps/control-plane-worker.js";
import { startDataPlaneApi } from "../apps/data-plane-api.js";
import { startDataPlaneGateway } from "../apps/data-plane-gateway.js";
import { startDataPlaneWorker } from "../apps/data-plane-worker.js";
import { registerProcessCleanupTask } from "../cleanup/index.js";
import { startDockerNetwork } from "../network/start-docker-network.js";
import { startNats } from "../services/nats/index.js";
import { startOtlpTestCollector } from "../services/otlp-test-collector.js";
import { ensureSeaweedfsS3BucketExists } from "../services/seaweedfs/index.js";
import { createTestEnvironmentSharedInfraKey } from "../services/shared-infra-coordinator.js";
import { acquireSharedMailpitInfra } from "../services/shared-mailpit.js";
import {
  acquireSharedPostgresInfra,
  type SharedPostgresLease,
} from "../services/shared-postgres.js";
import { acquireSharedSeaweedfsInfra } from "../services/shared-seaweedfs.js";
import { acquireSharedValkeyInfra, type SharedValkeyLease } from "../services/shared-valkey.js";
import { IntegrationConfigPathInContainer } from "../system/integration-config-paths.js";
import {
  DefaultSandboxBaseImageBuild,
  readPreparedTestHarnessRuntime,
} from "../system/prepared-runtime.js";
import { resolveHostPathFromContainerPath } from "../system/provision-system-integration-targets.js";
import { resolveSystemTestSandboxBaseImageSource } from "../system/system-test-sandbox-base-image-source.js";
import { createServiceRegistry } from "./registry.js";
import { ensureRunnerPoolSession } from "./runner-pool-session.js";
import { acquireRunnerServicePoolLease } from "./runner-service-pool.js";
import {
  createControlPlaneTestSchemaName,
  createControlPlaneWorkflowNamespaceId,
  createDataPlaneTestSchemaName,
  createDataPlaneWorkflowNamespaceId,
} from "./test-isolation.js";
import type {
  ResolvedTestInfra,
  TestService,
  TestInfraProvisioner,
  TestInfraRequirement,
  TestServiceDefinition,
  TestServiceEndpoints,
  TestServiceHandle,
  TestServiceLaunchMode,
  TestServiceRuntime,
  TestServiceRegistry,
  TestServiceStartInput,
} from "./types.js";

const execFileAsync = promisify(execFile);

const DefaultBuildContextHostPath = fileURLToPath(new URL("../../../..", import.meta.url));
const DefaultStartupTimeoutMs = 120_000;
const HostGatewayName = "host.testcontainers.internal";
const DockerSocketPath = "/var/run/docker.sock";
const RegistryImageReference = "registry:3";
const RegistryInternalPort = 5000;
const DeadServiceBaseUrl = "http://host.testcontainers.internal:9";
const ControlPlaneOpenWorkflowSchema = "control_plane_openworkflow";
const DataPlaneOpenWorkflowSchema = "data_plane_openworkflow";
const MigrationLockPollIntervalMs = 50;
const MigrationLockTimeoutMs = 120_000;
const PostgresCleanupRetryDelayMs = 100;
const PostgresCleanupMaxAttempts = 3;
const PostgresDeadlockDetectedCode = "40P01";
const PostgresMigrationCoordinatorRootDirectoryPath = join(
  tmpdir(),
  "mistle-test-harness",
  "postgres-migrations",
);

const InfraIds = {
  CONTROL_PLANE_POSTGRES: "postgres.control-plane",
  DATA_PLANE_POSTGRES: "postgres.data-plane",
  VALKEY: "valkey",
  MAILPIT: "mailpit",
  NATS: "nats",
  SEAWEEDFS: "seaweedfs",
  OTLP: "otlp",
  SANDBOX_BASE_IMAGE: "sandbox-base-image",
  SANDBOX_DOCKER_NETWORK: "sandbox-docker-network",
};

const PostgresValues = {
  HOST_DIRECT_URL: "host.directUrl",
  HOST_POOLED_URL: "host.pooledUrl",
  CONTAINER_DIRECT_URL: "container.directUrl",
  CONTAINER_POOLED_URL: "container.pooledUrl",
  CONTROL_PLANE_WORKFLOW_NAMESPACE_ID: "workflow.controlPlaneNamespaceId",
  DATA_PLANE_WORKFLOW_NAMESPACE_ID: "workflow.dataPlaneNamespaceId",
  CONTROL_PLANE_SCHEMA_NAME: "schema.controlPlane",
  DATA_PLANE_SCHEMA_NAME: "schema.dataPlane",
};

const InfraKinds = {
  POSTGRES: "postgres",
  VALKEY: "valkey",
  MAILPIT: "mailpit",
  NATS: "nats",
  SEAWEEDFS: "seaweedfs",
  OTLP: "otlp",
  SANDBOX_BASE_IMAGE: "sandbox-base-image",
  DOCKER_NETWORK: "docker-network",
};

const ValkeyValues = {
  HOST_URL: "host.url",
  CONTAINER_URL: "container.url",
  KEY_PREFIX: "keyPrefix",
};

const MailpitValues = {
  SMTP_HOST: "smtp.host",
  SMTP_PORT: "smtp.port",
  HTTP_BASE_URL: "http.baseUrl",
};

const NatsValues = {
  URL: "url",
};

const SeaweedfsValues = {
  BUCKET_NAME: "bucketName",
  HOST_ENDPOINT: "host.endpoint",
  CONTAINER_ENDPOINT: "container.endpoint",
  REGION: "region",
  ACCESS_KEY_ID: "accessKeyId",
  SECRET_ACCESS_KEY: "secretAccessKey",
};

const OtlpValues = {
  COLLECTOR_ID: "collectorId",
  BASE_URL: "baseUrl",
  TRACES_ENDPOINT: "traces.endpoint",
  LOGS_ENDPOINT: "logs.endpoint",
  METRICS_ENDPOINT: "metrics.endpoint",
};

const DockerNetworkValues = {
  NETWORK_NAME: "network.name",
};

const SandboxBaseImageValues = {
  IMAGE_REF: "image.ref",
};

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

function writeTimingLine(message: string): void {
  if (process.env["MISTLE_TEST_TIMING"] !== "1") {
    return;
  }

  process.stderr.write(`${message}\n`);
}

async function measure<T>(
  timings: Map<string, number>,
  label: string,
  callback: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await callback();
  } finally {
    timings.set(label, Date.now() - startedAt);
  }
}

function measureSync<T>(timings: Map<string, number>, label: string, callback: () => T): T {
  const startedAt = Date.now();
  try {
    return callback();
  } finally {
    timings.set(label, Date.now() - startedAt);
  }
}

function writeProvisionerTimingSummary(input: {
  environmentId: string;
  provisioner: string;
  timings: ReadonlyMap<string, number>;
}): void {
  const parts = Array.from(input.timings.entries()).map(
    ([label, durationMs]) => `${label}=${formatDuration(durationMs)}`,
  );

  writeTimingLine(
    `[integration] env ${input.environmentId} ${input.provisioner} phases: ${parts.join(", ")}.`,
  );
}

export type MistleTestServiceId =
  | "control-plane-api"
  | "control-plane-worker"
  | "data-plane-api"
  | "data-plane-gateway"
  | "data-plane-worker";

export type MistleTestExtraInfraId = "mailpit" | "nats" | "otlp" | "seaweedfs";

export type MistleTestRegistry = TestServiceRegistry & {
  "control-plane-api": TestServiceDefinition;
  "control-plane-worker": TestServiceDefinition;
  "data-plane-api": TestServiceDefinition;
  "data-plane-gateway": TestServiceDefinition;
  "data-plane-worker": TestServiceDefinition;
};

export type CreateTestRegistryInput = {
  buildContextHostPath?: string;
  configPathInContainer?: string;
  startupTimeoutMs?: number;
  sharedInfraKey?: string;
  __dangerouslyIsolatedServices?: {
    reason: string;
    services?: readonly MistleTestServiceId[];
  };
};

type MistleRegistryContext = {
  buildContextHostPath: string;
  configPathInContainer: string;
  startupTimeoutMs: number;
};

export function createTestRegistry(input: CreateTestRegistryInput = {}): MistleTestRegistry {
  ensureRunnerPoolSession(process.env);

  const context = createRegistryContext(input);
  const sharedInfraKey = input.sharedInfraKey ?? createTestEnvironmentSharedInfraKey(process.env);
  const postgresProvisioner = createPostgresProvisioner({
    sharedInfraKey,
    context,
  });
  const controlPlanePostgres = createPostgresRequirement({
    id: InfraIds.CONTROL_PLANE_POSTGRES,
    provisioner: postgresProvisioner,
  });
  const dataPlanePostgres = createPostgresRequirement({
    id: InfraIds.DATA_PLANE_POSTGRES,
    provisioner: postgresProvisioner,
  });
  const valkey = createValkeyRequirement({
    sharedInfraKey,
  });

  return createServiceRegistry({
    services: {
      "control-plane-api": createControlPlaneApiService({
        context,
        postgres: controlPlanePostgres,
      }),
      "control-plane-worker": createControlPlaneWorkerService({
        context,
        postgres: controlPlanePostgres,
      }),
      "data-plane-api": createDataPlaneApiService({
        context,
        postgres: dataPlanePostgres,
      }),
      "data-plane-gateway": createDataPlaneGatewayService({
        context,
        postgres: dataPlanePostgres,
        valkey,
      }),
      "data-plane-worker": createDataPlaneWorkerService({
        context,
        postgres: dataPlanePostgres,
      }),
    },
    ...(input.__dangerouslyIsolatedServices === undefined
      ? {}
      : {
          __dangerouslyIsolatedServices: input.__dangerouslyIsolatedServices,
        }),
  });
}

export function createTestExtraInfra(input: {
  ids: readonly MistleTestExtraInfraId[];
  sharedInfraKey?: string;
}): readonly TestInfraRequirement[] {
  const sharedInfraKey = input.sharedInfraKey ?? createTestEnvironmentSharedInfraKey();
  const requirements: TestInfraRequirement[] = [];

  for (const infraId of input.ids) {
    if (requirements.some((requirement) => requirement.id === infraId)) {
      continue;
    }

    switch (infraId) {
      case "mailpit":
        requirements.push(
          createMailpitRequirement({
            sharedInfraKey,
          }),
        );
        break;
      case "nats":
        requirements.push(createNatsRequirement());
        break;
      case "otlp":
        requirements.push(createOtlpRequirement());
        break;
      case "seaweedfs":
        requirements.push(
          createSeaweedfsRequirement({
            sharedInfraKey,
          }),
        );
        break;
    }
  }

  return requirements;
}

export function createDockerSandboxProviderInfra(): readonly TestInfraRequirement[] {
  return [createSandboxBaseImageRequirement(), createSandboxDockerNetworkRequirement()];
}

function createRegistryContext(input: {
  buildContextHostPath?: string;
  configPathInContainer?: string;
  startupTimeoutMs?: number;
}): MistleRegistryContext {
  return {
    buildContextHostPath: input.buildContextHostPath ?? DefaultBuildContextHostPath,
    configPathInContainer: input.configPathInContainer ?? IntegrationConfigPathInContainer,
    startupTimeoutMs: input.startupTimeoutMs ?? DefaultStartupTimeoutMs,
  };
}

function createPostgresRequirement(input: {
  id: string;
  provisioner: TestInfraProvisioner;
}): TestInfraRequirement {
  return {
    id: input.id,
    kind: InfraKinds.POSTGRES,
    provisioner: input.provisioner,
  };
}

function createSandboxDockerNetworkRequirement(): TestInfraRequirement {
  return {
    id: InfraIds.SANDBOX_DOCKER_NETWORK,
    kind: InfraKinds.DOCKER_NETWORK,
    provisioner: {
      kind: InfraKinds.DOCKER_NETWORK,
      provision: async (provisionInput) => {
        const network = await startDockerNetwork();
        const networkName = network.getName();

        return provisionInput.requirements.map((requirement) => ({
          id: requirement.id,
          kind: requirement.kind,
          values: new Map([[DockerNetworkValues.NETWORK_NAME, networkName]]),
          stop: async () => {
            await removeDockerSandboxContainersOnNetwork(networkName);
            await network.stop();
          },
        }));
      },
    },
  };
}

function createSandboxBaseImageRequirement(): TestInfraRequirement {
  return {
    id: InfraIds.SANDBOX_BASE_IMAGE,
    kind: InfraKinds.SANDBOX_BASE_IMAGE,
    provisioner: {
      kind: InfraKinds.SANDBOX_BASE_IMAGE,
      provision: async (provisionInput) => {
        const registry = await acquireSandboxBaseImageRegistry();
        const registryHttpEndpoint = registry.endpoints.http;
        if (registryHttpEndpoint === undefined) {
          throw new Error("Sandbox base image registry did not expose an HTTP endpoint.");
        }

        const registryAuthority = new URL(registryHttpEndpoint.hostBaseUrl).host;
        const sandboxBaseImageRef = `${registryAuthority}/${DefaultSandboxBaseImageBuild.repositoryPath}:dev`;

        return provisionInput.requirements.map((requirement) => ({
          id: requirement.id,
          kind: requirement.kind,
          values: new Map([[SandboxBaseImageValues.IMAGE_REF, sandboxBaseImageRef]]),
          stop: registry.release,
        }));
      },
    },
  };
}

async function acquireSandboxBaseImageRegistry(): Promise<
  TestServiceRuntime & { release: () => Promise<void> }
> {
  const session = ensureRunnerPoolSession(process.env);
  const source = resolveSystemTestSandboxBaseImageSource({
    env: process.env,
    localImageRef: DefaultSandboxBaseImageBuild.localReference,
  });
  return acquireRunnerServicePoolLease({
    runId: session.runId,
    coordinatorDir: session.coordinatorDir,
    key: `sandbox-base-image-registry:${source.kind}:${source.imageRef}:${DefaultSandboxBaseImageBuild.repositoryPath}`,
    start: async () =>
      startSandboxBaseImageRegistry({
        sourceImageRef: source.imageRef,
        pullSourceImage: source.kind === "prepublished",
      }),
    healthCheck: async (service) => {
      const httpEndpoint = service.endpoints.http;
      if (httpEndpoint === undefined) {
        throw new Error("Sandbox base image registry did not expose an HTTP endpoint.");
      }

      const response = await fetch(new URL("/v2/", httpEndpoint.hostBaseUrl));
      if (!response.ok) {
        throw new Error(
          `Sandbox base image registry health check failed with status ${String(response.status)}.`,
        );
      }
    },
  });
}

async function startSandboxBaseImageRegistry(input: {
  sourceImageRef: string;
  pullSourceImage: boolean;
}): Promise<TestServiceRuntime & { stop: () => Promise<void> }> {
  const registryContainer = await new GenericContainer(RegistryImageReference)
    .withEnvironment({
      REGISTRY_STORAGE_DELETE_ENABLED: "true",
    })
    .withExposedPorts(RegistryInternalPort)
    .start();
  const registryAuthority = `${registryContainer.getHost()}:${String(
    registryContainer.getMappedPort(RegistryInternalPort),
  )}`;
  const sandboxBaseImageRef = `${registryAuthority}/${DefaultSandboxBaseImageBuild.repositoryPath}:dev`;
  if (input.pullSourceImage) {
    await execFileAsync("docker", ["pull", input.sourceImageRef]);
  }
  await execFileAsync("docker", ["tag", input.sourceImageRef, sandboxBaseImageRef]);
  await execFileAsync("docker", ["push", sandboxBaseImageRef]);

  return {
    endpoints: {
      http: {
        hostBaseUrl: `http://${registryAuthority}`,
      },
    },
    containerId: registryContainer.getId(),
    stop: async () => {
      await registryContainer.stop({
        remove: true,
        removeVolumes: true,
        timeout: 0,
      });
    },
  };
}

async function removeDockerSandboxContainersOnNetwork(networkName: string): Promise<void> {
  const { stdout } = await execFileAsync("docker", [
    "ps",
    "-aq",
    "--filter",
    "label=mistle.sandbox.provider=docker",
    "--filter",
    `network=${networkName}`,
  ]);
  const containerIds = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (containerIds.length === 0) {
    return;
  }

  await execFileAsync("docker", ["rm", "--force", ...containerIds]);
}

function createPostgresProvisioner(input: {
  sharedInfraKey: string;
  context: MistleRegistryContext;
}): TestInfraProvisioner {
  let sharedLease: Promise<SharedPostgresLease> | undefined;
  let bootstrapMigrations: Promise<void> | undefined;

  const acquireLease = (): Promise<SharedPostgresLease> => {
    if (sharedLease !== undefined) {
      return sharedLease;
    }

    let leasePromise: Promise<SharedPostgresLease>;
    leasePromise = acquireSharedPostgresInfra({
      key: input.sharedInfraKey,
      postgres: {},
    }).then(
      (lease) => {
        registerProcessCleanupTask(async () => {
          await lease.release();
          if (sharedLease === leasePromise) {
            sharedLease = undefined;
          }
        });
        return lease;
      },
      (error: unknown) => {
        if (sharedLease === leasePromise) {
          sharedLease = undefined;
        }
        throw error;
      },
    );
    sharedLease = leasePromise;

    return leasePromise;
  };
  const runBootstrapMigrationsOnce = (migrationInput: {
    hostDirectUrl: string;
    migrationCoordinatorKey: string;
    timings: Map<string, number>;
  }): Promise<void> => {
    if (bootstrapMigrations !== undefined) {
      return bootstrapMigrations;
    }

    let migrationsPromise: Promise<void>;
    migrationsPromise = runPostgresBootstrapMigrationsOnceAcrossProcesses({
      context: input.context,
      hostDirectUrl: migrationInput.hostDirectUrl,
      migrationCoordinatorKey: migrationInput.migrationCoordinatorKey,
      timings: migrationInput.timings,
    }).catch((error: unknown) => {
      if (bootstrapMigrations === migrationsPromise) {
        bootstrapMigrations = undefined;
      }
      throw error;
    });
    bootstrapMigrations = migrationsPromise;
    return migrationsPromise;
  };
  return {
    kind: InfraKinds.POSTGRES,
    provision: async (provisionInput) => {
      const timings = new Map<string, number>();
      const lease = await measure(timings, "acquire-shared-lease", acquireLease);
      const resolved = measureSync(timings, "resolve-values", () => {
        const databaseName = lease.infra.postgres.postgres.databaseName;
        const workflowControlPlaneNamespaceId = createControlPlaneWorkflowNamespaceId(
          provisionInput.environmentId,
        );
        const workflowDataPlaneNamespaceId = createDataPlaneWorkflowNamespaceId(
          provisionInput.environmentId,
        );
        const controlPlaneSchemaName = createControlPlaneTestSchemaName(
          provisionInput.environmentId,
        );
        const dataPlaneSchemaName = createDataPlaneTestSchemaName(provisionInput.environmentId);

        const hostDirectUrl = createDatabaseUrl({
          username: lease.infra.postgres.postgres.username,
          password: lease.infra.postgres.postgres.password,
          host: lease.infra.postgres.postgres.host,
          port: lease.infra.postgres.postgres.port,
          databaseName,
        });
        const hostPooledUrl = createDatabaseUrl({
          username: lease.infra.postgres.postgres.username,
          password: lease.infra.postgres.postgres.password,
          host: lease.infra.postgres.pgbouncer.host,
          port: lease.infra.postgres.pgbouncer.port,
          databaseName,
        });
        const containerDirectUrl = createDatabaseUrl({
          username: lease.infra.postgres.postgres.username,
          password: lease.infra.postgres.postgres.password,
          host: lease.infra.containerHostGateway,
          port: lease.infra.postgres.postgres.port,
          databaseName,
        });
        const containerPooledUrl = createDatabaseUrl({
          username: lease.infra.postgres.postgres.username,
          password: lease.infra.postgres.postgres.password,
          host: lease.infra.containerHostGateway,
          port: lease.infra.postgres.pgbouncer.port,
          databaseName,
        });
        return {
          hostDirectUrl,
          hostPooledUrl,
          containerDirectUrl,
          containerPooledUrl,
          workflowControlPlaneNamespaceId,
          workflowDataPlaneNamespaceId,
          controlPlaneSchemaName,
          dataPlaneSchemaName,
          postgresContainerId: lease.infra.postgres.runtimeMetadata.postgresContainerId,
        };
      });
      const migrationFingerprint = await measure(timings, "migration-fingerprint", async () =>
        createPostgresBootstrapMigrationFingerprint(),
      );
      const migrationCoordinatorKey = createPostgresMigrationCoordinatorKey({
        sharedInfraKey: input.sharedInfraKey,
        postgresContainerId: resolved.postgresContainerId,
        migrationFingerprint,
      });

      await measure(timings, "bootstrap-migrations", async () =>
        runBootstrapMigrationsOnce({
          hostDirectUrl: resolved.hostDirectUrl,
          migrationCoordinatorKey,
          timings,
        }),
      );
      await measure(timings, "logical-migrations", async () => {
        await runPostgresLogicalMigrations({
          context: input.context,
          hostDirectUrl: resolved.hostDirectUrl,
          controlPlaneSchemaName: resolved.controlPlaneSchemaName,
          dataPlaneSchemaName: resolved.dataPlaneSchemaName,
          requirements: provisionInput.requirements,
          timings,
        });
      });
      writeProvisionerTimingSummary({
        environmentId: provisionInput.environmentId,
        provisioner: "postgres",
        timings,
      });

      return provisionInput.requirements.map((requirement) =>
        createResolvedPostgresInfra({
          requirement,
          resolved,
          lease,
          environmentId: provisionInput.environmentId,
        }),
      );
    },
  };
}

function createResolvedPostgresInfra(input: {
  requirement: TestInfraRequirement;
  resolved: {
    hostDirectUrl: string;
    hostPooledUrl: string;
    containerDirectUrl: string;
    containerPooledUrl: string;
    workflowControlPlaneNamespaceId: string;
    workflowDataPlaneNamespaceId: string;
    controlPlaneSchemaName: string;
    dataPlaneSchemaName: string;
  };
  lease: SharedPostgresLease;
  environmentId: string;
}): ResolvedTestInfra {
  return {
    id: input.requirement.id,
    kind: input.requirement.kind,
    values: new Map([
      [PostgresValues.HOST_DIRECT_URL, input.resolved.hostDirectUrl],
      [PostgresValues.HOST_POOLED_URL, input.resolved.hostPooledUrl],
      [PostgresValues.CONTAINER_DIRECT_URL, input.resolved.containerDirectUrl],
      [PostgresValues.CONTAINER_POOLED_URL, input.resolved.containerPooledUrl],
      [
        PostgresValues.CONTROL_PLANE_WORKFLOW_NAMESPACE_ID,
        input.resolved.workflowControlPlaneNamespaceId,
      ],
      [
        PostgresValues.DATA_PLANE_WORKFLOW_NAMESPACE_ID,
        input.resolved.workflowDataPlaneNamespaceId,
      ],
      [PostgresValues.CONTROL_PLANE_SCHEMA_NAME, input.resolved.controlPlaneSchemaName],
      [PostgresValues.DATA_PLANE_SCHEMA_NAME, input.resolved.dataPlaneSchemaName],
    ]),
    stop: async () => {
      const cleanupTimings = new Map<string, number>();
      await dropPostgresLogicalSchemas({
        requirement: input.requirement,
        lease: input.lease,
        environmentId: input.environmentId,
        controlPlaneSchemaName: input.resolved.controlPlaneSchemaName,
        dataPlaneSchemaName: input.resolved.dataPlaneSchemaName,
        timings: cleanupTimings,
      });
      writeProvisionerTimingSummary({
        environmentId: input.environmentId,
        provisioner: `postgres cleanup ${input.requirement.id}`,
        timings: cleanupTimings,
      });
    },
  };
}

function createValkeyRequirement(input: { sharedInfraKey: string }): TestInfraRequirement {
  return {
    id: InfraIds.VALKEY,
    kind: InfraKinds.VALKEY,
    provisioner: createValkeyProvisioner(input),
  };
}

function createValkeyProvisioner(input: { sharedInfraKey: string }): TestInfraProvisioner {
  let sharedLease: Promise<SharedValkeyLease> | undefined;

  const acquireLease = (): Promise<SharedValkeyLease> => {
    if (sharedLease !== undefined) {
      return sharedLease;
    }

    let leasePromise: Promise<SharedValkeyLease>;
    leasePromise = acquireSharedValkeyInfra({
      key: input.sharedInfraKey,
    }).then(
      (lease) => {
        registerProcessCleanupTask(async () => {
          await lease.release();
          if (sharedLease === leasePromise) {
            sharedLease = undefined;
          }
        });
        return lease;
      },
      (error: unknown) => {
        if (sharedLease === leasePromise) {
          sharedLease = undefined;
        }
        throw error;
      },
    );
    sharedLease = leasePromise;

    return leasePromise;
  };

  return {
    kind: InfraKinds.VALKEY,
    provision: async (provisionInput) => {
      const timings = new Map<string, number>();
      const lease = await measure(timings, "acquire-shared-lease", acquireLease);
      const keyPrefix = measureSync(
        timings,
        "resolve-values",
        () => `${createSafeIdentifier(provisionInput.environmentId)}:`,
      );
      writeProvisionerTimingSummary({
        environmentId: provisionInput.environmentId,
        provisioner: "valkey",
        timings,
      });

      return provisionInput.requirements.map((requirement) => ({
        id: requirement.id,
        kind: requirement.kind,
        values: new Map([
          [ValkeyValues.HOST_URL, lease.infra.valkey.url],
          [
            ValkeyValues.CONTAINER_URL,
            `redis://${HostGatewayName}:${String(lease.infra.valkey.port)}`,
          ],
          [ValkeyValues.KEY_PREFIX, keyPrefix],
        ]),
        stop: async () => {
          const cleanupTimings = new Map<string, number>();
          await measure(cleanupTimings, "delete-key-prefix", async () =>
            deleteValkeyKeysByPrefix({
              url: lease.infra.valkey.url,
              keyPrefix,
            }),
          );
          writeProvisionerTimingSummary({
            environmentId: provisionInput.environmentId,
            provisioner: "valkey cleanup",
            timings: cleanupTimings,
          });
        },
      }));
    },
  };
}

async function deleteValkeyKeysByPrefix(input: { url: string; keyPrefix: string }): Promise<void> {
  const client = createClient({
    url: input.url,
  });

  await client.connect();
  try {
    for await (const keys of client.scanIterator({
      MATCH: `${input.keyPrefix}*`,
      COUNT: 100,
    })) {
      if (keys.length === 0) {
        continue;
      }

      await client.del(keys);
    }
  } finally {
    await client.close();
  }
}

function createMailpitRequirement(input: { sharedInfraKey: string }): TestInfraRequirement {
  return {
    id: InfraIds.MAILPIT,
    kind: InfraKinds.MAILPIT,
    provisioner: createMailpitProvisioner(input),
  };
}

function createMailpitProvisioner(input: { sharedInfraKey: string }): TestInfraProvisioner {
  return {
    kind: InfraKinds.MAILPIT,
    provision: async (provisionInput) => {
      const timings = new Map<string, number>();
      const lease = await measure(timings, "acquire-physical", async () =>
        acquireSharedMailpitInfra({
          key: input.sharedInfraKey,
        }),
      );
      writeProvisionerTimingSummary({
        environmentId: provisionInput.environmentId,
        provisioner: "mailpit",
        timings,
      });

      return provisionInput.requirements.map((requirement) => ({
        id: requirement.id,
        kind: requirement.kind,
        values: new Map([
          [MailpitValues.SMTP_HOST, lease.infra.mailpit.smtpHost],
          [MailpitValues.SMTP_PORT, String(lease.infra.mailpit.smtpPort)],
          [MailpitValues.HTTP_BASE_URL, lease.infra.mailpit.httpBaseUrl],
        ]),
        stop: async () => {
          const cleanupTimings = new Map<string, number>();
          await measure(cleanupTimings, "release-lease", lease.release);
          writeProvisionerTimingSummary({
            environmentId: provisionInput.environmentId,
            provisioner: "mailpit cleanup",
            timings: cleanupTimings,
          });
        },
      }));
    },
  };
}

function createOtlpRequirement(): TestInfraRequirement {
  return {
    id: InfraIds.OTLP,
    kind: InfraKinds.OTLP,
    provisioner: createOtlpProvisioner(),
  };
}

function createOtlpProvisioner(): TestInfraProvisioner {
  return {
    kind: InfraKinds.OTLP,
    provision: async (provisionInput) => {
      const timings = new Map<string, number>();
      const collector = await measure(timings, "start", startOtlpTestCollector);
      writeProvisionerTimingSummary({
        environmentId: provisionInput.environmentId,
        provisioner: "otlp",
        timings,
      });

      return provisionInput.requirements.map((requirement) => ({
        id: requirement.id,
        kind: requirement.kind,
        values: new Map([
          [OtlpValues.COLLECTOR_ID, collector.id],
          [OtlpValues.BASE_URL, collector.baseUrl],
          [OtlpValues.TRACES_ENDPOINT, collector.endpointForPath("/v1/traces")],
          [OtlpValues.LOGS_ENDPOINT, collector.endpointForPath("/v1/logs")],
          [OtlpValues.METRICS_ENDPOINT, collector.endpointForPath("/v1/metrics")],
        ]),
        stop: async () => {
          const cleanupTimings = new Map<string, number>();
          await measure(cleanupTimings, "stop", collector.stop);
          writeProvisionerTimingSummary({
            environmentId: provisionInput.environmentId,
            provisioner: "otlp cleanup",
            timings: cleanupTimings,
          });
        },
      }));
    },
  };
}

function createNatsRequirement(): TestInfraRequirement {
  return {
    id: InfraIds.NATS,
    kind: InfraKinds.NATS,
    provisioner: createNatsProvisioner(),
  };
}

function createNatsProvisioner(): TestInfraProvisioner {
  return {
    kind: InfraKinds.NATS,
    provision: async (provisionInput) => {
      const timings = new Map<string, number>();
      const nats = await measure(timings, "start", startNats);
      writeProvisionerTimingSummary({
        environmentId: provisionInput.environmentId,
        provisioner: "nats",
        timings,
      });

      return provisionInput.requirements.map((requirement) => ({
        id: requirement.id,
        kind: requirement.kind,
        values: new Map([[NatsValues.URL, nats.url]]),
        stop: async () => {
          const cleanupTimings = new Map<string, number>();
          await measure(cleanupTimings, "stop", nats.stop);
          writeProvisionerTimingSummary({
            environmentId: provisionInput.environmentId,
            provisioner: "nats cleanup",
            timings: cleanupTimings,
          });
        },
      }));
    },
  };
}

function createSeaweedfsRequirement(input: { sharedInfraKey: string }): TestInfraRequirement {
  return {
    id: InfraIds.SEAWEEDFS,
    kind: InfraKinds.SEAWEEDFS,
    provisioner: createSeaweedfsProvisioner(input),
  };
}

function createSeaweedfsProvisioner(input: { sharedInfraKey: string }): TestInfraProvisioner {
  return {
    kind: InfraKinds.SEAWEEDFS,
    provision: async (provisionInput) => {
      const timings = new Map<string, number>();
      const lease = await measure(timings, "acquire-physical", async () =>
        acquireSharedSeaweedfsInfra({
          key: input.sharedInfraKey,
        }),
      );
      const bucketName = createSeaweedfsBucketName(provisionInput.environmentId);
      await measure(timings, "create-bucket", async () =>
        ensureSeaweedfsS3BucketExists({
          bucketName,
          endpoint: lease.infra.seaweedfs.endpoint,
          accessKeyId: lease.infra.seaweedfs.accessKeyId,
          secretAccessKey: lease.infra.seaweedfs.secretAccessKey,
          startupTimeoutMs: 15_000,
        }),
      );
      writeProvisionerTimingSummary({
        environmentId: provisionInput.environmentId,
        provisioner: "seaweedfs",
        timings,
      });

      return provisionInput.requirements.map((requirement) => ({
        id: requirement.id,
        kind: requirement.kind,
        values: new Map([
          [SeaweedfsValues.BUCKET_NAME, bucketName],
          [SeaweedfsValues.HOST_ENDPOINT, lease.infra.seaweedfs.endpoint],
          [
            SeaweedfsValues.CONTAINER_ENDPOINT,
            createContainerReachableEndpoint(lease.infra.seaweedfs.endpoint),
          ],
          [SeaweedfsValues.REGION, lease.infra.seaweedfs.region],
          [SeaweedfsValues.ACCESS_KEY_ID, lease.infra.seaweedfs.accessKeyId],
          [SeaweedfsValues.SECRET_ACCESS_KEY, lease.infra.seaweedfs.secretAccessKey],
        ]),
        stop: async () => {
          const cleanupTimings = new Map<string, number>();
          await measure(cleanupTimings, "release-lease", lease.release);
          writeProvisionerTimingSummary({
            environmentId: provisionInput.environmentId,
            provisioner: "seaweedfs cleanup",
            timings: cleanupTimings,
          });
        },
      }));
    },
  };
}

function createSeaweedfsBucketName(environmentId: string): string {
  return `mistle-${environmentId.replaceAll("_", "-")}`;
}

function createContainerReachableEndpoint(hostEndpoint: string): string {
  const url = new URL(hostEndpoint);
  url.hostname = HostGatewayName;
  return url.toString().replace(/\/$/u, "");
}

function createControlPlaneApiService(input: {
  context: MistleRegistryContext;
  postgres: TestInfraRequirement;
}): TestServiceDefinition {
  return {
    id: "control-plane-api",
    infra: [input.postgres],
    serviceReferences: [],
    supportedModes: ["docker"],
    healthCheck: async (service) => checkHttpServiceHealth(service, "control-plane-api"),
    start: async (startInput) =>
      startControlPlaneApiDockerService({
        context: input.context,
        startInput,
      }),
  };
}

async function startControlPlaneApiDockerService(input: {
  context: MistleRegistryContext;
  startInput: TestServiceStartInput;
}): Promise<TestService> {
  assertDockerMode(input.startInput.mode, "control-plane-api");
  const preparedRuntime = await readPreparedTestHarnessRuntime(input.context.buildContextHostPath);
  const postgres = getInfra(input.startInput.infra, InfraIds.CONTROL_PLANE_POSTGRES);
  const seaweedfs = input.startInput.infra.get(InfraIds.SEAWEEDFS);
  const service = await startControlPlaneApi({
    buildContextHostPath: input.context.buildContextHostPath,
    configPathInContainer: input.context.configPathInContainer,
    startupTimeoutMs: input.context.startupTimeoutMs,
    prebuiltImageName: preparedRuntime.appImages.controlPlaneApi,
    environment: {
      MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: readInfraValue(
        postgres,
        PostgresValues.CONTAINER_POOLED_URL,
      ),
      MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL: readInfraValue(
        postgres,
        PostgresValues.CONTAINER_DIRECT_URL,
      ),
      MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID: readInfraValue(
        postgres,
        PostgresValues.CONTROL_PLANE_WORKFLOW_NAMESPACE_ID,
      ),
      MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL: "http://localhost:5100",
      MISTLE_SERVICES_DASHBOARD_PUBLIC_URL: "http://localhost:5173",
      MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS:
        "http://localhost:5100,http://127.0.0.1:5100,http://localhost:5173,http://127.0.0.1:5173",
      MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL: readOptionalServiceContainerBaseUrl({
        services: input.startInput.services,
        serviceId: "data-plane-api",
      }),
      MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL:
        "ws://localhost:5202/tunnel/sandbox",
      ...createControlPlaneApiObjectStoreEnv(seaweedfs),
    },
    bindMounts: [createConfigBindMount(input.context)],
  });

  return {
    id: "control-plane-api",
    mode: input.startInput.mode,
    endpoints: createHttpEndpoints({
      hostBaseUrl: service.hostBaseUrl,
      internalBaseUrl: service.containerBaseUrl,
    }),
    containerId: service.containerId,
    stop: service.stop,
  };
}

function createControlPlaneApiObjectStoreEnv(
  seaweedfs: ResolvedTestInfra | undefined,
): Record<string, string> {
  if (seaweedfs === undefined) {
    return {
      MISTLE_OBJECT_STORE_ASSETS_BUCKET_NAME: "integration-new-media",
      MISTLE_OBJECT_STORE_ASSETS_REGION: "us-east-1",
      MISTLE_OBJECT_STORE_ASSETS_ENDPOINT: "http://host.testcontainers.internal:9",
      MISTLE_OBJECT_STORE_ASSETS_FORCE_PATH_STYLE: "true",
      MISTLE_OBJECT_STORE_ASSETS_ACCESS_KEY_ID: "integration-new-access-key",
      MISTLE_OBJECT_STORE_ASSETS_SECRET_ACCESS_KEY: "integration-new-secret-key",
    };
  }

  return {
    MISTLE_OBJECT_STORE_ASSETS_BUCKET_NAME: readInfraValue(seaweedfs, SeaweedfsValues.BUCKET_NAME),
    MISTLE_OBJECT_STORE_ASSETS_REGION: readInfraValue(seaweedfs, SeaweedfsValues.REGION),
    MISTLE_OBJECT_STORE_ASSETS_ENDPOINT: readInfraValue(
      seaweedfs,
      SeaweedfsValues.CONTAINER_ENDPOINT,
    ),
    MISTLE_OBJECT_STORE_ASSETS_FORCE_PATH_STYLE: "true",
    MISTLE_OBJECT_STORE_ASSETS_ACCESS_KEY_ID: readInfraValue(
      seaweedfs,
      SeaweedfsValues.ACCESS_KEY_ID,
    ),
    MISTLE_OBJECT_STORE_ASSETS_SECRET_ACCESS_KEY: readInfraValue(
      seaweedfs,
      SeaweedfsValues.SECRET_ACCESS_KEY,
    ),
  };
}

function createDataPlaneApiService(input: {
  context: MistleRegistryContext;
  postgres: TestInfraRequirement;
}): TestServiceDefinition {
  return {
    id: "data-plane-api",
    infra: [input.postgres],
    serviceReferences: ["control-plane-api"],
    supportedModes: ["docker"],
    healthCheck: async (service) => checkHttpServiceHealth(service, "data-plane-api"),
    start: async (startInput) =>
      startDataPlaneApiDockerService({
        context: input.context,
        startInput,
      }),
  };
}

async function startDataPlaneApiDockerService(input: {
  context: MistleRegistryContext;
  startInput: TestServiceStartInput;
}): Promise<TestService> {
  assertDockerMode(input.startInput.mode, "data-plane-api");
  const preparedRuntime = await readPreparedTestHarnessRuntime(input.context.buildContextHostPath);
  const postgres = getInfra(input.startInput.infra, InfraIds.DATA_PLANE_POSTGRES);
  const service = await startDataPlaneApi({
    buildContextHostPath: input.context.buildContextHostPath,
    configPathInContainer: input.context.configPathInContainer,
    startupTimeoutMs: input.context.startupTimeoutMs,
    prebuiltImageName: preparedRuntime.appImages.dataPlaneApi,
    bindMounts: [
      createConfigBindMount(input.context),
      {
        source: DockerSocketPath,
        target: DockerSocketPath,
        mode: "rw",
      },
    ],
    environment: {
      MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: readInfraValue(
        postgres,
        PostgresValues.CONTAINER_POOLED_URL,
      ),
      MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL: readInfraValue(
        postgres,
        PostgresValues.CONTAINER_DIRECT_URL,
      ),
      MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID: readInfraValue(
        postgres,
        PostgresValues.DATA_PLANE_WORKFLOW_NAMESPACE_ID,
      ),
      MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL: readOptionalServiceContainerBaseUrl({
        services: input.startInput.services,
        serviceId: "data-plane-gateway",
      }),
      MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: readOptionalServiceContainerBaseUrl({
        services: input.startInput.services,
        serviceId: "control-plane-api",
      }),
      MISTLE_SANDBOX_DOCKER_SOCKET_PATH: DockerSocketPath,
    },
  });

  return {
    id: "data-plane-api",
    mode: input.startInput.mode,
    endpoints: createHttpEndpoints({
      hostBaseUrl: service.hostBaseUrl,
      internalBaseUrl: service.containerBaseUrl,
    }),
    containerId: service.containerId,
    stop: service.stop,
  };
}

function createDataPlaneGatewayService(input: {
  context: MistleRegistryContext;
  postgres: TestInfraRequirement;
  valkey: TestInfraRequirement;
}): TestServiceDefinition {
  return {
    id: "data-plane-gateway",
    infra: [input.postgres, input.valkey],
    serviceReferences: ["control-plane-api", "data-plane-api"],
    endpoints: {
      http: {
        host: "127.0.0.1",
      },
    },
    supportedModes: ["docker"],
    healthCheck: async (service) => checkHttpServiceHealth(service, "data-plane-gateway"),
    start: async (startInput) =>
      startDataPlaneGatewayDockerService({
        context: input.context,
        startInput,
      }),
  };
}

async function startDataPlaneGatewayDockerService(input: {
  context: MistleRegistryContext;
  startInput: TestServiceStartInput;
}): Promise<TestService> {
  assertDockerMode(input.startInput.mode, "data-plane-gateway");
  const preparedRuntime = await readPreparedTestHarnessRuntime(input.context.buildContextHostPath);
  const postgres = getInfra(input.startInput.infra, InfraIds.DATA_PLANE_POSTGRES);
  const valkey = getInfra(input.startInput.infra, InfraIds.VALKEY);
  const service = await startDataPlaneGateway({
    buildContextHostPath: input.context.buildContextHostPath,
    configPathInContainer: input.context.configPathInContainer,
    startupTimeoutMs: input.context.startupTimeoutMs,
    prebuiltImageName: preparedRuntime.appImages.dataPlaneGateway,
    hostPort: readPlannedHttpHostPort({
      plannedEndpoints: input.startInput.plannedEndpoints,
      serviceId: "data-plane-gateway",
    }),
    environment: {
      MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: readInfraValue(
        postgres,
        PostgresValues.CONTAINER_POOLED_URL,
      ),
      MISTLE_KV_DATA_PLANE_BACKEND: "valkey",
      MISTLE_KV_DATA_PLANE_URL: readInfraValue(valkey, ValkeyValues.CONTAINER_URL),
      MISTLE_KV_DATA_PLANE_KEY_PREFIX: readInfraValue(valkey, ValkeyValues.KEY_PREFIX),
      MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL: readOptionalServiceContainerBaseUrl({
        services: input.startInput.services,
        serviceId: "data-plane-api",
      }),
      MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: readOptionalServiceContainerBaseUrl({
        services: input.startInput.services,
        serviceId: "control-plane-api",
      }),
    },
    bindMounts: [createConfigBindMount(input.context)],
  });

  return {
    id: "data-plane-gateway",
    mode: input.startInput.mode,
    endpoints: createHttpEndpoints({
      hostBaseUrl: service.hostBaseUrl,
      internalBaseUrl: service.containerBaseUrl,
    }),
    containerId: service.containerId,
    stop: service.stop,
  };
}

function createControlPlaneWorkerService(input: {
  context: MistleRegistryContext;
  postgres: TestInfraRequirement;
}): TestServiceDefinition {
  return {
    id: "control-plane-worker",
    infra: [input.postgres],
    serviceReferences: ["control-plane-api", "data-plane-api"],
    supportedModes: ["docker"],
    healthCheck: async (service) => checkContainerServiceHealth(service, "control-plane-worker"),
    start: async (startInput) =>
      startControlPlaneWorkerDockerService({
        context: input.context,
        startInput,
      }),
  };
}

async function startControlPlaneWorkerDockerService(input: {
  context: MistleRegistryContext;
  startInput: TestServiceStartInput;
}): Promise<TestService> {
  assertDockerMode(input.startInput.mode, "control-plane-worker");
  const preparedRuntime = await readPreparedTestHarnessRuntime(input.context.buildContextHostPath);
  const postgres = getInfra(input.startInput.infra, InfraIds.CONTROL_PLANE_POSTGRES);
  const mailpit = input.startInput.infra.get(InfraIds.MAILPIT);
  const service = await startControlPlaneWorker({
    buildContextHostPath: input.context.buildContextHostPath,
    configPathInContainer: input.context.configPathInContainer,
    startupTimeoutMs: input.context.startupTimeoutMs,
    prebuiltImageName: preparedRuntime.appImages.controlPlaneWorker,
    environment: {
      MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: readInfraValue(
        postgres,
        PostgresValues.CONTAINER_POOLED_URL,
      ),
      MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID: readInfraValue(
        postgres,
        PostgresValues.CONTROL_PLANE_WORKFLOW_NAMESPACE_ID,
      ),
      MISTLE_EMAIL_SMTP_HOST:
        mailpit === undefined
          ? "host.testcontainers.internal"
          : readInfraValue(mailpit, MailpitValues.SMTP_HOST),
      MISTLE_EMAIL_SMTP_PORT:
        mailpit === undefined ? "9" : readInfraValue(mailpit, MailpitValues.SMTP_PORT),
      MISTLE_EMAIL_SMTP_SECURE: "false",
      MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL: readOptionalServiceContainerBaseUrl({
        services: input.startInput.services,
        serviceId: "data-plane-api",
      }),
      MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: readOptionalServiceContainerBaseUrl({
        services: input.startInput.services,
        serviceId: "control-plane-api",
      }),
    },
    bindMounts: [createConfigBindMount(input.context)],
  });

  return {
    id: "control-plane-worker",
    mode: input.startInput.mode,
    endpoints: {},
    containerId: service.containerId,
    stop: service.stop,
  };
}

function createDataPlaneWorkerService(input: {
  context: MistleRegistryContext;
  postgres: TestInfraRequirement;
}): TestServiceDefinition {
  return {
    id: "data-plane-worker",
    infra: [input.postgres],
    serviceReferences: ["data-plane-gateway", "control-plane-api"],
    supportedModes: ["docker"],
    healthCheck: async (service) => checkContainerServiceHealth(service, "data-plane-worker"),
    start: async (startInput) =>
      startDataPlaneWorkerDockerService({
        context: input.context,
        startInput,
      }),
  };
}

async function startDataPlaneWorkerDockerService(input: {
  context: MistleRegistryContext;
  startInput: TestServiceStartInput;
}): Promise<TestService> {
  assertDockerMode(input.startInput.mode, "data-plane-worker");
  const preparedRuntime = await readPreparedTestHarnessRuntime(input.context.buildContextHostPath);
  const postgres = getInfra(input.startInput.infra, InfraIds.DATA_PLANE_POSTGRES);
  const gatewayBaseUrl = readOptionalServiceContainerBaseUrl({
    services: input.startInput.services,
    serviceId: "data-plane-gateway",
  });
  const service = await startDataPlaneWorker({
    buildContextHostPath: input.context.buildContextHostPath,
    configPathInContainer: input.context.configPathInContainer,
    startupTimeoutMs: input.context.startupTimeoutMs,
    prebuiltImageName: preparedRuntime.appImages.dataPlaneWorker,
    environment: {
      MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: readInfraValue(
        postgres,
        PostgresValues.CONTAINER_POOLED_URL,
      ),
      MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID: readInfraValue(
        postgres,
        PostgresValues.DATA_PLANE_WORKFLOW_NAMESPACE_ID,
      ),
      MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL: gatewayBaseUrl,
      MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL:
        createWebSocketBaseUrl(gatewayBaseUrl),
      MISTLE_SANDBOX_DOCKER_ENABLED: "true",
      MISTLE_SANDBOX_DOCKER_SOCKET_PATH: DockerSocketPath,
      MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: readOptionalServiceContainerBaseUrl({
        services: input.startInput.services,
        serviceId: "control-plane-api",
      }),
    },
    bindMounts: [createConfigBindMount(input.context)],
  });

  return {
    id: "data-plane-worker",
    mode: input.startInput.mode,
    endpoints: {},
    containerId: service.containerId,
    stop: service.stop,
  };
}

function createPostgresMigrationCoordinatorKey(input: {
  sharedInfraKey: string;
  postgresContainerId: string;
  migrationFingerprint: string;
}): string {
  return createHash("sha256")
    .update(input.sharedInfraKey)
    .update("\0")
    .update(input.postgresContainerId)
    .update("\0")
    .update(input.migrationFingerprint)
    .digest("hex");
}

async function createPostgresBootstrapMigrationFingerprint(): Promise<string> {
  const hash = createHash("sha256");
  await hashDirectory({
    hash,
    rootDirectory: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
    relativeDirectory: ".",
  });
  await hashDirectory({
    hash,
    rootDirectory: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
    relativeDirectory: ".",
  });
  return hash.digest("hex");
}

async function hashDirectory(input: {
  hash: ReturnType<typeof createHash>;
  rootDirectory: string;
  relativeDirectory: string;
}): Promise<void> {
  const directoryPath =
    input.relativeDirectory === "."
      ? input.rootDirectory
      : join(input.rootDirectory, input.relativeDirectory);
  const entries = await readdir(directoryPath, {
    withFileTypes: true,
  });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath =
      input.relativeDirectory === "." ? entry.name : join(input.relativeDirectory, entry.name);
    input.hash.update(relativePath);
    input.hash.update("\0");

    if (entry.isDirectory()) {
      await hashDirectory({
        hash: input.hash,
        rootDirectory: input.rootDirectory,
        relativeDirectory: relativePath,
      });
      continue;
    }

    if (entry.isFile()) {
      input.hash.update(await readFile(join(input.rootDirectory, relativePath)));
      input.hash.update("\0");
    }
  }
}

async function runPostgresBootstrapMigrations(input: {
  context: MistleRegistryContext;
  hostDirectUrl: string;
  timings: Map<string, number>;
}): Promise<void> {
  await measure(input.timings, "reset-bootstrap-template-schemas", async () =>
    resetPostgresBootstrapTemplateSchemas(input.hostDirectUrl),
  );
  await measure(input.timings, "bootstrap-data-plane-db-migrations", async () =>
    runDataPlaneMigrations({
      connectionString: input.hostDirectUrl,
      schemaName: DATA_PLANE_SCHEMA_NAME,
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
    }),
  );
  await measure(input.timings, "bootstrap-control-plane-db-migrations", async () =>
    runControlPlaneMigrations({
      connectionString: input.hostDirectUrl,
      schemaName: CONTROL_PLANE_SCHEMA_NAME,
      migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
    }),
  );
  await measure(input.timings, "bootstrap-data-plane-workflow-migrations", async () =>
    runOpenWorkflowPostgresMigrations({
      url: input.hostDirectUrl,
      namespaceId: "template",
      schema: DataPlaneOpenWorkflowSchema,
    }),
  );
  await measure(input.timings, "bootstrap-control-plane-workflow-migrations", async () =>
    runOpenWorkflowPostgresMigrations({
      url: input.hostDirectUrl,
      namespaceId: "template",
      schema: ControlPlaneOpenWorkflowSchema,
    }),
  );
}

async function runPostgresBootstrapMigrationsOnceAcrossProcesses(input: {
  context: MistleRegistryContext;
  hostDirectUrl: string;
  migrationCoordinatorKey: string;
  timings: Map<string, number>;
}): Promise<void> {
  await withPostgresMigrationCoordinatorLock(input.migrationCoordinatorKey, async () => {
    if (await hasPostgresBootstrapMigrationMarker(input.migrationCoordinatorKey)) {
      return;
    }

    await runPostgresBootstrapMigrations({
      context: input.context,
      hostDirectUrl: input.hostDirectUrl,
      timings: input.timings,
    });
    await writePostgresBootstrapMigrationMarker(input.migrationCoordinatorKey);
  });
}

async function runPostgresLogicalMigrations(input: {
  context: MistleRegistryContext;
  hostDirectUrl: string;
  controlPlaneSchemaName: string;
  dataPlaneSchemaName: string;
  requirements: readonly TestInfraRequirement[];
  timings: Map<string, number>;
}): Promise<void> {
  const materializations: Promise<void>[] = [];

  if (requiresControlPlanePostgres(input.requirements)) {
    materializations.push(
      measure(input.timings, "logical-control-plane-db-migrations", async () =>
        runControlPlaneMigrations({
          connectionString: input.hostDirectUrl,
          schemaName: input.controlPlaneSchemaName,
          migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
          migrationsSchema: createLogicalMigrationTrackingSchemaName(input.controlPlaneSchemaName),
          migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
        }),
      ),
    );
  }

  if (requiresDataPlanePostgres(input.requirements)) {
    materializations.push(
      measure(input.timings, "logical-data-plane-db-migrations", async () =>
        runDataPlaneMigrations({
          connectionString: input.hostDirectUrl,
          schemaName: input.dataPlaneSchemaName,
          migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
          migrationsSchema: createLogicalMigrationTrackingSchemaName(input.dataPlaneSchemaName),
          migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
        }),
      ),
    );
  }

  await Promise.all(materializations);
}

function createLogicalMigrationTrackingSchemaName(schemaName: string): string {
  return `meta_${createSafeIdentifier(schemaName)}`;
}

async function dropPostgresLogicalSchemas(input: {
  requirement: TestInfraRequirement;
  lease: SharedPostgresLease;
  environmentId: string;
  controlPlaneSchemaName: string;
  dataPlaneSchemaName: string;
  timings: Map<string, number>;
}): Promise<void> {
  if (input.requirement.id === InfraIds.CONTROL_PLANE_POSTGRES) {
    await measure(input.timings, "drop-control-plane-schema", async () =>
      dropPostgresSchemas({
        lease: input.lease,
        environmentId: input.environmentId,
        schemaNames: [
          input.controlPlaneSchemaName,
          createLogicalMigrationTrackingSchemaName(input.controlPlaneSchemaName),
        ],
      }),
    );
    return;
  }

  if (input.requirement.id === InfraIds.DATA_PLANE_POSTGRES) {
    await measure(input.timings, "drop-data-plane-schema", async () =>
      dropPostgresSchemas({
        lease: input.lease,
        environmentId: input.environmentId,
        schemaNames: [
          input.dataPlaneSchemaName,
          createLogicalMigrationTrackingSchemaName(input.dataPlaneSchemaName),
        ],
      }),
    );
    return;
  }

  throw new Error(`Unknown Postgres infra requirement '${input.requirement.id}'.`);
}

function requiresControlPlanePostgres(requirements: readonly TestInfraRequirement[]): boolean {
  return requirements.some((requirement) => requirement.id === InfraIds.CONTROL_PLANE_POSTGRES);
}

function requiresDataPlanePostgres(requirements: readonly TestInfraRequirement[]): boolean {
  return requirements.some((requirement) => requirement.id === InfraIds.DATA_PLANE_POSTGRES);
}

async function runOpenWorkflowPostgresMigrations(input: {
  url: string;
  namespaceId: string;
  schema: string;
}): Promise<void> {
  const backend = await BackendPostgres.connect(input.url, {
    namespaceId: input.namespaceId,
    runMigrations: true,
    schema: input.schema,
  });

  await backend.stop();
}

async function resetPostgresBootstrapTemplateSchemas(connectionString: string): Promise<void> {
  const client = new Client({
    connectionString,
  });
  await client.connect();

  try {
    for (const schemaName of [
      CONTROL_PLANE_SCHEMA_NAME,
      DATA_PLANE_SCHEMA_NAME,
      MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
      MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      ControlPlaneOpenWorkflowSchema,
      DataPlaneOpenWorkflowSchema,
    ]) {
      await client.query(`drop schema if exists ${quoteSqlIdentifier(schemaName)} cascade`);
    }
  } finally {
    await client.end();
  }
}

async function withPostgresMigrationCoordinatorLock<T>(
  migrationCoordinatorKey: string,
  callback: () => Promise<T>,
): Promise<T> {
  const lockDirectoryPath = join(
    PostgresMigrationCoordinatorRootDirectoryPath,
    `${migrationCoordinatorKey}.lock`,
  );
  const ownerFilePath = join(lockDirectoryPath, "owner.json");
  const deadline = Date.now() + MigrationLockTimeoutMs;

  await mkdir(PostgresMigrationCoordinatorRootDirectoryPath, {
    recursive: true,
  });

  while (Date.now() < deadline) {
    try {
      await mkdir(lockDirectoryPath);
      await writeJsonFileAtomic(ownerFilePath, { pid: process.pid, createdAt: Date.now() });

      try {
        return await callback();
      } finally {
        await rm(lockDirectoryPath, {
          recursive: true,
          force: true,
        });
      }
    } catch (error) {
      if (!isNodeErrorCode(error, "EEXIST")) {
        throw error;
      }

      const ownerPid = await readPostgresMigrationLockOwnerPid(ownerFilePath);
      if (ownerPid !== undefined && !isProcessAlive(ownerPid)) {
        await rm(lockDirectoryPath, {
          recursive: true,
          force: true,
        });
        continue;
      }

      await systemSleeper.sleep(MigrationLockPollIntervalMs);
    }
  }

  throw new Error(
    `Timed out acquiring Postgres migration lock after ${String(MigrationLockTimeoutMs)}ms.`,
  );
}

async function hasPostgresBootstrapMigrationMarker(
  migrationCoordinatorKey: string,
): Promise<boolean> {
  try {
    await readFile(createPostgresBootstrapMigrationMarkerPath(migrationCoordinatorKey), "utf8");
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function writePostgresBootstrapMigrationMarker(
  migrationCoordinatorKey: string,
): Promise<void> {
  await writeJsonFileAtomic(createPostgresBootstrapMigrationMarkerPath(migrationCoordinatorKey), {
    completedAt: Date.now(),
    pid: process.pid,
  });
}

function createPostgresBootstrapMigrationMarkerPath(migrationCoordinatorKey: string): string {
  return join(PostgresMigrationCoordinatorRootDirectoryPath, `${migrationCoordinatorKey}.ready`);
}

async function readPostgresMigrationLockOwnerPid(
  ownerFilePath: string,
): Promise<number | undefined> {
  try {
    const raw = await readFile(ownerFilePath, "utf8");
    const parsed = parseJsonRecordIfComplete(raw);
    if (parsed === undefined) {
      return undefined;
    }
    const pid = parsed["pid"];
    if (typeof pid !== "number") {
      return undefined;
    }
    return pid;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

async function writeJsonFileAtomic(
  filePath: string,
  value: Record<string, unknown>,
): Promise<void> {
  const temporaryFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryFilePath, `${JSON.stringify(value)}\n`, "utf8");
  await rename(temporaryFilePath, filePath);
}

function parseJsonRecordIfComplete(raw: string): Record<string, unknown> | undefined {
  try {
    return parseJsonRecord(raw);
  } catch {
    return undefined;
  }
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error("Expected JSON object.");
  }
  return parsed;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error["code"] === code;
}

function isPostgresErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error["code"] === code;
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (isNodeErrorCode(error, "ESRCH")) {
      return false;
    }
    if (isNodeErrorCode(error, "EPERM")) {
      return true;
    }
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function dropPostgresSchemas(input: {
  lease: SharedPostgresLease;
  environmentId: string;
  schemaNames: readonly string[];
}): Promise<void> {
  const client = new Client({
    connectionString: createDatabaseUrl({
      username: input.lease.infra.postgres.postgres.username,
      password: input.lease.infra.postgres.postgres.password,
      host: input.lease.infra.postgres.postgres.host,
      port: input.lease.infra.postgres.postgres.port,
      databaseName: input.lease.infra.postgres.postgres.databaseName,
      applicationName: createPostgresCleanupApplicationName(input.environmentId),
    }),
  });

  await client.connect();
  try {
    for (const schemaName of input.schemaNames) {
      await dropPostgresSchemaWithRetry({
        client,
        schemaName,
      });
    }
  } finally {
    await client.end();
  }
}

async function dropPostgresSchemaWithRetry(input: {
  client: Client;
  schemaName: string;
}): Promise<void> {
  let lastDiagnostics: readonly PostgresActivityDiagnostic[] = [];

  for (let attempt = 1; attempt <= PostgresCleanupMaxAttempts; attempt += 1) {
    try {
      await input.client.query(
        `drop schema if exists ${quoteSqlIdentifier(input.schemaName)} cascade`,
      );
      return;
    } catch (error) {
      if (!isPostgresErrorCode(error, PostgresDeadlockDetectedCode)) {
        throw error;
      }

      lastDiagnostics = await readPostgresActivityDiagnostics({
        client: input.client,
        schemaName: input.schemaName,
      });

      if (attempt === PostgresCleanupMaxAttempts) {
        throw new Error(
          `Deadlock while dropping Postgres test schema '${input.schemaName}' after ${String(
            PostgresCleanupMaxAttempts,
          )} attempts. Lock diagnostics: ${JSON.stringify(lastDiagnostics)}`,
          {
            cause: error,
          },
        );
      }

      await systemSleeper.sleep(PostgresCleanupRetryDelayMs * attempt);
    }
  }
}

type PostgresActivityDiagnostic = {
  pid: number;
  applicationName: string | null;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  query: string | null;
};

async function readPostgresActivityDiagnostics(input: {
  client: Client;
  schemaName: string;
}): Promise<readonly PostgresActivityDiagnostic[]> {
  const result = await input.client.query<PostgresActivityDiagnostic>(
    `
      with target_namespaces as (
        select oid
        from pg_namespace
        where nspname = $1
      ),
      target_relations as (
        select oid
        from pg_class
        where relnamespace in (select oid from target_namespaces)
      ),
      target_pids as (
        select distinct pg_locks.pid
        from pg_locks
        where pg_locks.pid <> pg_backend_pid()
          and (
            (
              pg_locks.locktype = 'object'
              and pg_locks.classid = 'pg_namespace'::regclass
              and pg_locks.objid in (select oid from target_namespaces)
            )
            or pg_locks.relation in (select oid from target_relations)
          )
      )
      select
        pg_stat_activity.pid,
        pg_stat_activity.application_name as "applicationName",
        pg_stat_activity.state,
        pg_stat_activity.wait_event_type as "waitEventType",
        pg_stat_activity.wait_event as "waitEvent",
        left(pg_stat_activity.query, 500) as query
      from pg_stat_activity
      where pg_stat_activity.pid in (select pid from target_pids)
      order by pg_stat_activity.pid
    `,
    [input.schemaName],
  );

  return result.rows;
}

function createDatabaseUrl(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
  applicationName?: string;
}): string {
  const url = new URL(
    `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(
      input.password,
    )}@${input.host}:${String(input.port)}/${input.databaseName}`,
  );
  if (input.applicationName !== undefined) {
    url.searchParams.set("application_name", input.applicationName);
  }

  return url.toString();
}

export function createPostgresCleanupApplicationName(environmentId: string): string {
  return `mistle_test_cleanup_${createSafeIdentifier(environmentId)}`;
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function createSafeIdentifier(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 10);
  const compact = normalized.length === 0 ? "env" : normalized.slice(0, 28);
  return `${compact}_${digest}`;
}

function getInfra(infra: ReadonlyMap<string, ResolvedTestInfra>, id: string): ResolvedTestInfra {
  const resolved = infra.get(id);
  if (resolved === undefined) {
    throw new Error(`Expected Mistle test infra '${id}' to be resolved.`);
  }

  return resolved;
}

function readInfraValue(infra: ResolvedTestInfra, key: string): string {
  const value = infra.values.get(key);
  if (value === undefined) {
    throw new Error(`Expected Mistle test infra '${infra.id}' to expose '${key}'.`);
  }

  return value;
}

function readOptionalServiceContainerBaseUrl(input: {
  services: ReadonlyMap<string, TestServiceHandle>;
  serviceId: string;
}): string {
  const service = input.services.get(input.serviceId);
  if (service === undefined) {
    return DeadServiceBaseUrl;
  }

  return createContainerReachableBaseUrl(service);
}

function readPlannedHttpHostPort(input: {
  plannedEndpoints: ReadonlyMap<string, TestServiceEndpoints>;
  serviceId: string;
}): number {
  const endpoint = input.plannedEndpoints.get(input.serviceId)?.http;
  if (endpoint === undefined) {
    throw new Error(
      `Expected Mistle test service '${input.serviceId}' to have a planned HTTP endpoint.`,
    );
  }

  const url = new URL(endpoint.hostBaseUrl);
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error(
      `Expected Mistle test service '${input.serviceId}' planned HTTP endpoint to include a concrete host port.`,
    );
  }

  return port;
}

function createContainerReachableBaseUrl(service: TestServiceHandle): string {
  const httpEndpoint = service.endpoints.http;
  if (httpEndpoint === undefined) {
    throw new Error(`Expected Mistle test service '${service.id}' to expose an HTTP endpoint.`);
  }

  if (httpEndpoint.internalBaseUrl !== undefined) {
    return httpEndpoint.internalBaseUrl;
  }

  const url = new URL(httpEndpoint.hostBaseUrl);
  url.hostname = HostGatewayName;
  return url.toString().replace(/\/$/u, "");
}

function createHttpEndpoints(input: {
  hostBaseUrl: string;
  internalBaseUrl: string;
}): TestServiceEndpoints {
  return {
    http: {
      hostBaseUrl: input.hostBaseUrl,
      internalBaseUrl: input.internalBaseUrl,
    },
  };
}

async function checkHttpServiceHealth(
  service: TestServiceRuntime,
  serviceId: MistleTestServiceId,
): Promise<void> {
  const httpEndpoint = service.endpoints.http;
  if (httpEndpoint === undefined) {
    throw new Error(`Expected Mistle test service '${serviceId}' to expose an HTTP endpoint.`);
  }

  const response = await fetch(new URL("/__healthz", httpEndpoint.hostBaseUrl));
  if (!response.ok) {
    throw new Error(
      `Mistle test service '${serviceId}' health check returned ${String(response.status)}.`,
    );
  }
}

async function checkContainerServiceHealth(
  service: TestServiceRuntime,
  serviceId: MistleTestServiceId,
): Promise<void> {
  if (service.containerId === undefined) {
    throw new Error(`Expected Mistle test service '${serviceId}' to expose a container id.`);
  }

  const { stdout } = await execFileAsync("docker", [
    "inspect",
    "-f",
    "{{.State.Running}}",
    service.containerId,
  ]);
  if (stdout.trim() !== "true") {
    throw new Error(`Mistle test service '${serviceId}' container is not running.`);
  }
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
    return url.toString().replace(/\/$/u, "");
  }
  if (url.protocol === "https:") {
    url.protocol = "wss:";
    return url.toString().replace(/\/$/u, "");
  }

  throw new Error(`Expected HTTP base URL to create WebSocket URL, received '${httpBaseUrl}'.`);
}

function createConfigBindMount(input: MistleRegistryContext): {
  source: string;
  target: string;
  mode: "ro";
} {
  return {
    source: dirname(
      resolveHostPathFromContainerPath({
        buildContextHostPath: input.buildContextHostPath,
        containerPath: input.configPathInContainer,
      }),
    ),
    target: dirname(input.configPathInContainer),
    mode: "ro",
  };
}

function assertDockerMode(mode: TestServiceLaunchMode, serviceId: string): void {
  if (mode !== "docker") {
    throw new Error(`Mistle test service '${serviceId}' currently supports docker mode only.`);
  }
}

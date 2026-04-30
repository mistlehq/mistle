import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { startControlPlaneApi } from "../apps/control-plane-api.js";
import { startControlPlaneWorker } from "../apps/control-plane-worker.js";
import { startDataPlaneApi } from "../apps/data-plane-api.js";
import { startDataPlaneGateway } from "../apps/data-plane-gateway.js";
import { startDataPlaneWorker } from "../apps/data-plane-worker.js";
import { startTokenizerProxy } from "../apps/tokenizer-proxy.js";
import { runCleanupTasks } from "../cleanup/index.js";
import { acquireSharedMailpitInfra } from "../services/shared-mailpit.js";
import { acquireSharedPostgresInfra } from "../services/shared-postgres.js";
import { startValkey, type ValkeyService } from "../services/valkey/index.js";
import { DockerIntegrationConfigPathInContainer } from "../system/integration-config-paths.js";
import { readPreparedTestHarnessRuntime } from "../system/prepared-runtime.js";
import {
  createControlPlaneDatabaseMigrationCommandInput,
  createControlPlaneWorkflowMigrationCommandInput,
  createDataPlaneDatabaseMigrationCommandInput,
  createDataPlaneWorkflowMigrationCommandInput,
  resolveHostPathFromContainerPath,
} from "../system/provision-system-integration-targets.js";
import { createServiceRegistry } from "./registry.js";
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
const DefaultSharedInfraKey = "mistle-test-environment";
const HostGatewayName = "host.testcontainers.internal";
const DockerSocketPath = "/var/run/docker.sock";
const DeadServiceBaseUrl = "http://host.testcontainers.internal:9";

const InfraIds = {
  POSTGRES: "postgres",
  VALKEY: "valkey",
  MAILPIT: "mailpit",
};

const InfraKinds = {
  POSTGRES: "postgres",
  VALKEY: "valkey",
  MAILPIT: "mailpit",
};

const PostgresValues = {
  HOST_DIRECT_URL: "host.directUrl",
  HOST_POOLED_URL: "host.pooledUrl",
  CONTAINER_DIRECT_URL: "container.directUrl",
  CONTAINER_POOLED_URL: "container.pooledUrl",
  CONTROL_PLANE_WORKFLOW_NAMESPACE_ID: "workflow.controlPlaneNamespaceId",
  DATA_PLANE_WORKFLOW_NAMESPACE_ID: "workflow.dataPlaneNamespaceId",
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

export type MistleTestServiceId =
  | "control-plane-api"
  | "control-plane-worker"
  | "data-plane-api"
  | "data-plane-gateway"
  | "data-plane-worker"
  | "tokenizer-proxy";

export type MistleTestRegistry = TestServiceRegistry & {
  "control-plane-api": TestServiceDefinition;
  "control-plane-worker": TestServiceDefinition;
  "data-plane-api": TestServiceDefinition;
  "data-plane-gateway": TestServiceDefinition;
  "data-plane-worker": TestServiceDefinition;
  "tokenizer-proxy": TestServiceDefinition;
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

type LocalValkeyLease = {
  service: ValkeyService;
  leaseCount: number;
};

export function createTestRegistry(input: CreateTestRegistryInput = {}): MistleTestRegistry {
  const context = {
    buildContextHostPath: input.buildContextHostPath ?? DefaultBuildContextHostPath,
    configPathInContainer: input.configPathInContainer ?? DockerIntegrationConfigPathInContainer,
    startupTimeoutMs: input.startupTimeoutMs ?? DefaultStartupTimeoutMs,
  };
  const sharedInfraKey = input.sharedInfraKey ?? DefaultSharedInfraKey;
  const postgres = createPostgresRequirement({
    sharedInfraKey,
    context,
  });
  const valkey = createValkeyRequirement();
  const mailpit = createMailpitRequirement({
    sharedInfraKey,
  });

  return createServiceRegistry({
    services: {
      "control-plane-api": createControlPlaneApiService({
        context,
        postgres,
      }),
      "control-plane-worker": createControlPlaneWorkerService({
        context,
        postgres,
        mailpit,
      }),
      "data-plane-api": createDataPlaneApiService({
        context,
        postgres,
      }),
      "data-plane-gateway": createDataPlaneGatewayService({
        context,
        postgres,
        valkey,
      }),
      "data-plane-worker": createDataPlaneWorkerService({
        context,
        postgres,
      }),
      "tokenizer-proxy": createTokenizerProxyService({
        context,
      }),
    },
    ...(input.__dangerouslyIsolatedServices === undefined
      ? {}
      : {
          __dangerouslyIsolatedServices: input.__dangerouslyIsolatedServices,
        }),
  });
}

function createPostgresRequirement(input: {
  sharedInfraKey: string;
  context: MistleRegistryContext;
}): TestInfraRequirement {
  return {
    id: InfraIds.POSTGRES,
    kind: InfraKinds.POSTGRES,
    provisioner: createPostgresProvisioner(input),
  };
}

function createPostgresProvisioner(input: {
  sharedInfraKey: string;
  context: MistleRegistryContext;
}): TestInfraProvisioner {
  return {
    kind: InfraKinds.POSTGRES,
    provision: async (provisionInput) => {
      const lease = await acquireSharedPostgresInfra({
        key: input.sharedInfraKey,
        postgres: {},
      });
      const databaseName = createPostgresDatabaseName(provisionInput.environmentId);
      const workflowControlPlaneNamespaceId = createWorkflowNamespaceId({
        prefix: "cp",
        environmentId: provisionInput.environmentId,
      });
      const workflowDataPlaneNamespaceId = createWorkflowNamespaceId({
        prefix: "dp",
        environmentId: provisionInput.environmentId,
      });
      let databaseCreated = false;

      try {
        await runPostgresAdminCommand({
          containerId: lease.infra.postgres.runtimeMetadata.postgresContainerId,
          username: lease.infra.postgres.postgres.username,
          sql: `create database "${databaseName}"`,
        });
        databaseCreated = true;

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

        await runPostgresMigrations({
          context: input.context,
          hostDirectUrl,
          workflowControlPlaneNamespaceId,
          workflowDataPlaneNamespaceId,
        });

        return provisionInput.requirements.map((requirement) => ({
          id: requirement.id,
          kind: requirement.kind,
          values: new Map([
            [PostgresValues.HOST_DIRECT_URL, hostDirectUrl],
            [PostgresValues.HOST_POOLED_URL, hostPooledUrl],
            [PostgresValues.CONTAINER_DIRECT_URL, containerDirectUrl],
            [PostgresValues.CONTAINER_POOLED_URL, containerPooledUrl],
            [PostgresValues.CONTROL_PLANE_WORKFLOW_NAMESPACE_ID, workflowControlPlaneNamespaceId],
            [PostgresValues.DATA_PLANE_WORKFLOW_NAMESPACE_ID, workflowDataPlaneNamespaceId],
          ]),
          stop: async () => {
            await runCleanupTasks({
              tasks: [
                async () => {
                  await dropPostgresDatabase({
                    containerId: lease.infra.postgres.runtimeMetadata.postgresContainerId,
                    username: lease.infra.postgres.postgres.username,
                    databaseName,
                  });
                },
                lease.release,
              ],
              context: `Mistle test Postgres cleanup for ${databaseName}`,
            });
          },
        }));
      } catch (error) {
        if (databaseCreated) {
          await dropPostgresDatabase({
            containerId: lease.infra.postgres.runtimeMetadata.postgresContainerId,
            username: lease.infra.postgres.postgres.username,
            databaseName,
          });
        }

        await lease.release();
        throw error;
      }
    },
  };
}

function createValkeyRequirement(): TestInfraRequirement {
  return {
    id: InfraIds.VALKEY,
    kind: InfraKinds.VALKEY,
    provisioner: createValkeyProvisioner(),
  };
}

function createValkeyProvisioner(): TestInfraProvisioner {
  let lease: LocalValkeyLease | undefined;

  return {
    kind: InfraKinds.VALKEY,
    provision: async (provisionInput) => {
      if (lease === undefined) {
        lease = {
          service: await startValkey({
            manageProcessCleanup: false,
          }),
          leaseCount: 0,
        };
      }

      lease.leaseCount += 1;
      const activeLease = lease;
      const keyPrefix = `${createSafeIdentifier(provisionInput.environmentId)}:`;

      return provisionInput.requirements.map((requirement) => ({
        id: requirement.id,
        kind: requirement.kind,
        values: new Map([
          [ValkeyValues.HOST_URL, activeLease.service.url],
          [
            ValkeyValues.CONTAINER_URL,
            `redis://${HostGatewayName}:${String(activeLease.service.port)}`,
          ],
          [ValkeyValues.KEY_PREFIX, keyPrefix],
        ]),
        stop: async () => {
          activeLease.leaseCount -= 1;
          if (activeLease.leaseCount > 0) {
            return;
          }

          await activeLease.service.stop();
          if (lease === activeLease) {
            lease = undefined;
          }
        },
      }));
    },
  };
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
      const lease = await acquireSharedMailpitInfra({
        key: input.sharedInfraKey,
      });

      return provisionInput.requirements.map((requirement) => ({
        id: requirement.id,
        kind: requirement.kind,
        values: new Map([
          [MailpitValues.SMTP_HOST, lease.infra.containerHostGateway],
          [MailpitValues.SMTP_PORT, String(lease.infra.mailpit.smtpPort)],
          [MailpitValues.HTTP_BASE_URL, lease.infra.mailpit.httpBaseUrl],
        ]),
        stop: lease.release,
      }));
    },
  };
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
  const postgres = getInfra(input.startInput.infra, InfraIds.POSTGRES);
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
  const postgres = getInfra(input.startInput.infra, InfraIds.POSTGRES);
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
  const postgres = getInfra(input.startInput.infra, InfraIds.POSTGRES);
  const valkey = getInfra(input.startInput.infra, InfraIds.VALKEY);
  const service = await startDataPlaneGateway({
    buildContextHostPath: input.context.buildContextHostPath,
    configPathInContainer: input.context.configPathInContainer,
    startupTimeoutMs: input.context.startupTimeoutMs,
    prebuiltImageName: preparedRuntime.appImages.dataPlaneGateway,
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

function createTokenizerProxyService(input: {
  context: MistleRegistryContext;
}): TestServiceDefinition {
  return {
    id: "tokenizer-proxy",
    infra: [],
    serviceReferences: ["control-plane-api"],
    supportedModes: ["docker"],
    healthCheck: async (service) => checkHttpServiceHealth(service, "tokenizer-proxy"),
    start: async (startInput) => {
      assertDockerMode(startInput.mode, "tokenizer-proxy");
      const preparedRuntime = await readPreparedTestHarnessRuntime(
        input.context.buildContextHostPath,
      );
      const service = await startTokenizerProxy({
        buildContextHostPath: input.context.buildContextHostPath,
        configPathInContainer: input.context.configPathInContainer,
        startupTimeoutMs: input.context.startupTimeoutMs,
        prebuiltImageName: preparedRuntime.appImages.tokenizerProxy,
        environment: {
          MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: readOptionalServiceContainerBaseUrl({
            services: startInput.services,
            serviceId: "control-plane-api",
          }),
          MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL: "http://localhost:5100",
        },
        bindMounts: [createConfigBindMount(input.context)],
      });

      return {
        id: "tokenizer-proxy",
        mode: startInput.mode,
        endpoints: createHttpEndpoints({
          hostBaseUrl: service.hostBaseUrl,
          internalBaseUrl: service.containerBaseUrl,
        }),
        containerId: service.containerId,
        stop: service.stop,
      };
    },
  };
}

function createControlPlaneWorkerService(input: {
  context: MistleRegistryContext;
  postgres: TestInfraRequirement;
  mailpit: TestInfraRequirement;
}): TestServiceDefinition {
  return {
    id: "control-plane-worker",
    infra: [input.postgres, input.mailpit],
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
  const postgres = getInfra(input.startInput.infra, InfraIds.POSTGRES);
  const mailpit = getInfra(input.startInput.infra, InfraIds.MAILPIT);
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
      MISTLE_EMAIL_SMTP_HOST: readInfraValue(mailpit, MailpitValues.SMTP_HOST),
      MISTLE_EMAIL_SMTP_PORT: readInfraValue(mailpit, MailpitValues.SMTP_PORT),
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
    serviceReferences: ["data-plane-gateway", "tokenizer-proxy", "control-plane-api"],
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
  const postgres = getInfra(input.startInput.infra, InfraIds.POSTGRES);
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
      MISTLE_SANDBOX_PROVIDER: "docker",
      MISTLE_SANDBOX_DOCKER_SOCKET_PATH: DockerSocketPath,
      MISTLE_SERVICES_TOKENIZER_PROXY_EGRESS_URL: readOptionalServiceContainerBaseUrl({
        services: input.startInput.services,
        serviceId: "tokenizer-proxy",
      }),
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

async function runPostgresMigrations(input: {
  context: MistleRegistryContext;
  hostDirectUrl: string;
  workflowControlPlaneNamespaceId: string;
  workflowDataPlaneNamespaceId: string;
}): Promise<void> {
  await runSystemCommand(
    createDataPlaneDatabaseMigrationCommandInput({
      buildContextHostPath: input.context.buildContextHostPath,
      configPathInContainer: input.context.configPathInContainer,
      hostDatabaseUrl: input.hostDirectUrl,
    }),
  );
  await runSystemCommand({
    ...createDataPlaneWorkflowMigrationCommandInput({
      buildContextHostPath: input.context.buildContextHostPath,
      configPathInContainer: input.context.configPathInContainer,
      hostDatabaseUrl: input.hostDirectUrl,
    }),
    env: {
      ...createDataPlaneWorkflowMigrationCommandInput({
        buildContextHostPath: input.context.buildContextHostPath,
        configPathInContainer: input.context.configPathInContainer,
        hostDatabaseUrl: input.hostDirectUrl,
      }).env,
      MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID: input.workflowDataPlaneNamespaceId,
    },
  });
  await runSystemCommand(
    createControlPlaneDatabaseMigrationCommandInput({
      buildContextHostPath: input.context.buildContextHostPath,
      configPathInContainer: input.context.configPathInContainer,
      hostDatabaseUrl: input.hostDirectUrl,
    }),
  );
  await runSystemCommand({
    ...createControlPlaneWorkflowMigrationCommandInput({
      buildContextHostPath: input.context.buildContextHostPath,
      configPathInContainer: input.context.configPathInContainer,
      hostDatabaseUrl: input.hostDirectUrl,
    }),
    env: {
      ...createControlPlaneWorkflowMigrationCommandInput({
        buildContextHostPath: input.context.buildContextHostPath,
        configPathInContainer: input.context.configPathInContainer,
        hostDatabaseUrl: input.hostDirectUrl,
      }).env,
      MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID: input.workflowControlPlaneNamespaceId,
    },
  });
}

async function runSystemCommand(input: {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
}): Promise<void> {
  await execFileAsync(input.command, [...input.args], {
    cwd: input.cwd,
    env: {
      ...process.env,
      ...input.env,
    },
  });
}

async function dropPostgresDatabase(input: {
  containerId: string;
  username: string;
  databaseName: string;
}): Promise<void> {
  await runPostgresAdminCommand({
    containerId: input.containerId,
    username: input.username,
    sql: `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${input.databaseName.replaceAll("'", "''")}'`,
  });
  await runPostgresAdminCommand({
    containerId: input.containerId,
    username: input.username,
    sql: `drop database if exists "${input.databaseName}"`,
  });
}

async function runPostgresAdminCommand(input: {
  containerId: string;
  username: string;
  sql: string;
}): Promise<void> {
  await execFileAsync("docker", [
    "exec",
    input.containerId,
    "psql",
    "-U",
    input.username,
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    input.sql,
  ]);
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

function createPostgresDatabaseName(environmentId: string): string {
  return `mistle_test_${createSafeIdentifier(environmentId)}`;
}

function createWorkflowNamespaceId(input: { prefix: string; environmentId: string }): string {
  return `${input.prefix}_${createSafeIdentifier(input.environmentId)}`;
}

function createSafeIdentifier(value: string): string {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 10);
  const compact = normalized.length === 0 ? "env" : normalized.slice(0, 40);
  return `${compact}_${digest}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
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

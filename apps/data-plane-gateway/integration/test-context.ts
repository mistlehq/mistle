/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * Vitest fixture extension file intentionally uses `vitestIt.extend(...)`.
 */

import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { getLocalDevDockerRegistrySandboxBaseImageRef } from "@mistle/config";
import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import {
  DockerIntegrationConfigPathInContainer,
  createIntegrationRuntimeScopeId,
  createIntegrationRuntimeDatabaseName,
  getCurrentVitestFilePath,
  readTestContext,
  reserveAvailablePort,
  runCleanupTasks,
  startDataPlaneApi,
} from "@mistle/test-harness";
import { systemClock, systemSleeper } from "@mistle/time";
import { Pool, Client } from "pg";
import { it as vitestIt } from "vitest";
import { z } from "zod";

import { ensureCommitSignBinary } from "../../control-plane-api/integration/helpers/commit-sign.js";
import { startControlPlaneApiProcess } from "../../data-plane-worker/integration/helpers/control-plane-api.js";
import { createDataPlaneGatewayRuntime } from "../src/runtime/index.js";
import type { DataPlaneGatewayRuntime, DataPlaneGatewayRuntimeConfig } from "../src/types.js";
import {
  DataPlaneGatewayIntegrationTestContextId,
  DataPlaneGatewayRuntimeDatabaseNamePrefix,
} from "./context-config.js";

const IntegrationBootstrapTokenSecret = "integration-bootstrap-token-secret";
const IntegrationConnectTokenSecret = "integration-connect-token-secret";
const IntegrationTokenIssuer = "integration-data-plane-worker";
const IntegrationTokenAudience = "integration-data-plane-gateway";
const PROJECT_ROOT_HOST_PATH = fileURLToPath(new URL("../../..", import.meta.url));
const CONFIG_FIXTURE_HOST_PATH = fileURLToPath(
  new URL("../../../packages/config/integration/fixtures/config.toml", import.meta.url),
);
const DATA_PLANE_API_STARTUP_TIMEOUT_MS = 120_000;
const GATEWAY_HEALTHCHECK_PATH = "/__healthz";
const GATEWAY_STARTUP_TIMEOUT_MS = 30_000;
const GATEWAY_HEALTH_POLL_INTERVAL_MS = 100;
const INTERNAL_AUTH_SERVICE_TOKEN = "integration-service-token";
const DockerSocketPath = "/var/run/docker.sock";

const SharedInfraConfigSchema = z
  .object({
    databaseUsername: z.string().min(1),
    databasePassword: z.string().min(1),
    databaseDirectHost: z.string().min(1),
    databaseDirectPort: z.number().int().min(1).max(65_535),
    valkeyUrl: z.string().min(1),
    templateDatabaseName: z.string().min(1),
    integrationRunId: z.string().min(1),
  })
  .strict();

type SharedInfraConfig = z.infer<typeof SharedInfraConfigSchema>;

export type DataPlaneGatewayIntegrationDatabaseStack = {
  directUrl: string;
  pooledUrl: string;
};

export type DataPlaneGatewayIntegrationFixture = {
  baseUrl: string;
  websocketBaseUrl: string;
  config: DataPlaneGatewayRuntimeConfig;
  controlPlaneBaseUrl: string;
  controlPlaneDb: ControlPlaneDatabase;
  databaseStack: DataPlaneGatewayIntegrationDatabaseStack;
  db: DataPlaneDatabase;
  dbPool: Pool;
  internalAuthServiceToken: string;
  otlpRequests: Array<{
    body: string;
    path: string;
  }>;
  runtime: DataPlaneGatewayRuntime;
  workflowNamespaceId: string;
};

type RuntimeStateBackend = DataPlaneGatewayRuntimeConfig["app"]["runtimeState"]["backend"];

async function readSharedInfraConfig(): Promise<SharedInfraConfig> {
  return readTestContext({
    id: DataPlaneGatewayIntegrationTestContextId,
    schema: SharedInfraConfigSchema,
  });
}

function assertSafeIdentifier(identifier: string, label: string): string {
  if (!/^[a-z0-9_]+$/u.test(identifier)) {
    throw new Error(`${label} must contain only lowercase alphanumeric and underscore characters.`);
  }

  return identifier;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
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

function createFileScopedDatabaseName(input: {
  integrationRunId: string;
  filePath: string;
  scopeId: string;
}): string {
  return createIntegrationRuntimeDatabaseName({
    prefix: DataPlaneGatewayRuntimeDatabaseNamePrefix,
    runId: input.integrationRunId,
    filePath: input.filePath,
    scopeId: input.scopeId,
  });
}

async function resetWorkerDatabaseFromTemplate(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  templateDatabaseName: string;
  runtimeDatabaseName: string;
}): Promise<void> {
  const adminClient = new Client({
    connectionString: createDatabaseUrl({
      username: input.username,
      password: input.password,
      host: input.host,
      port: input.port,
      databaseName: "postgres",
    }),
  });

  const quotedTemplateDatabaseName = quoteIdentifier(
    assertSafeIdentifier(input.templateDatabaseName, "template database"),
  );
  const quotedRuntimeDatabaseName = quoteIdentifier(
    assertSafeIdentifier(input.runtimeDatabaseName, "runtime database"),
  );

  await adminClient.connect();
  try {
    await adminClient.query(`DROP DATABASE IF EXISTS ${quotedRuntimeDatabaseName} WITH (FORCE)`);
    await adminClient.query(
      `CREATE DATABASE ${quotedRuntimeDatabaseName} TEMPLATE ${quotedTemplateDatabaseName}`,
    );
  } finally {
    await adminClient.end();
  }
}

async function dropDatabaseIfExists(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
}): Promise<void> {
  const adminClient = new Client({
    connectionString: createDatabaseUrl({
      username: input.username,
      password: input.password,
      host: input.host,
      port: input.port,
      databaseName: "postgres",
    }),
  });

  const quotedRuntimeDatabaseName = quoteIdentifier(
    assertSafeIdentifier(input.databaseName, "runtime database"),
  );

  await adminClient.connect();
  try {
    await adminClient.query(`DROP DATABASE IF EXISTS ${quotedRuntimeDatabaseName} WITH (FORCE)`);
  } finally {
    await adminClient.end();
  }
}

async function waitForGatewayHealth(input: { baseUrl: string }): Promise<void> {
  const deadline = systemClock.nowMs() + GATEWAY_STARTUP_TIMEOUT_MS;

  while (systemClock.nowMs() < deadline) {
    try {
      const response = await fetch(new URL(GATEWAY_HEALTHCHECK_PATH, input.baseUrl));
      if (response.status === 200) {
        return;
      }
    } catch {}

    await systemSleeper.sleep(GATEWAY_HEALTH_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for data-plane-gateway healthcheck at ${new URL(GATEWAY_HEALTHCHECK_PATH, input.baseUrl).toString()}.`,
  );
}

function createRuntimeStateConfig(input: {
  backend: RuntimeStateBackend;
  runtimeDatabaseName: string;
  valkeyUrl: string;
}): DataPlaneGatewayRuntimeConfig["app"]["runtimeState"] {
  if (input.backend === "memory") {
    return {
      backend: "memory",
    };
  }

  return {
    backend: "valkey",
    valkey: {
      url: input.valkeyUrl,
      keyPrefix: `mistle:runtime-state:gateway-integration:${input.runtimeDatabaseName}`,
    },
  };
}

async function startOtlpReceiver(): Promise<{
  close: () => Promise<void>;
  requests: Array<{
    body: string;
    path: string;
  }>;
  url: string;
}> {
  const requests: Array<{
    body: string;
    path: string;
  }> = [];

  const server = createServer((request, response) => {
    const chunks: Uint8Array[] = [];

    request.on("data", (chunk: Uint8Array) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      requests.push({
        body: Buffer.concat(chunks).toString("utf8"),
        path: request.url ?? "/",
      });
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end("{}");
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected OTLP integration receiver to bind an ephemeral TCP port.");
  }

  return {
    requests,
    url: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

function createIntegrationIt(backend: RuntimeStateBackend) {
  return vitestIt.extend<{ fixture: DataPlaneGatewayIntegrationFixture }>({
    fixture: [
      async ({}, use) => {
        const cleanupTasks: Array<() => Promise<void>> = [];
        const sharedInfraConfig = await readSharedInfraConfig();
        const commitSignBinaryPath = await ensureCommitSignBinary();
        const runtimeDatabaseName = createFileScopedDatabaseName({
          integrationRunId: sharedInfraConfig.integrationRunId,
          filePath: getCurrentVitestFilePath(),
          scopeId: createIntegrationRuntimeScopeId(),
        });

        try {
          const otlpReceiver = await startOtlpReceiver();
          cleanupTasks.unshift(async () => {
            await otlpReceiver.close();
          });

          await resetWorkerDatabaseFromTemplate({
            username: sharedInfraConfig.databaseUsername,
            password: sharedInfraConfig.databasePassword,
            host: sharedInfraConfig.databaseDirectHost,
            port: sharedInfraConfig.databaseDirectPort,
            templateDatabaseName: sharedInfraConfig.templateDatabaseName,
            runtimeDatabaseName,
          });

          const runtimeDatabaseUrl = createDatabaseUrl({
            username: sharedInfraConfig.databaseUsername,
            password: sharedInfraConfig.databasePassword,
            host: sharedInfraConfig.databaseDirectHost,
            port: sharedInfraConfig.databaseDirectPort,
            databaseName: runtimeDatabaseName,
          });
          const containerRuntimeDatabaseUrl = createDatabaseUrl({
            username: sharedInfraConfig.databaseUsername,
            password: sharedInfraConfig.databasePassword,
            host: "host.testcontainers.internal",
            port: sharedInfraConfig.databaseDirectPort,
            databaseName: runtimeDatabaseName,
          });
          const gatewayPort = await reserveAvailablePort({ host: "127.0.0.1" });
          const workflowNamespaceId = `gateway_it_${runtimeDatabaseName}`;

          const dbPool = new Pool({
            connectionString: runtimeDatabaseUrl,
          });
          cleanupTasks.unshift(async () => {
            await dbPool.end();
          });
          const db = createDataPlaneDatabase(dbPool);
          const controlPlaneDb = createControlPlaneDatabase(dbPool);

          const dataPlaneApi = await startDataPlaneApi({
            buildContextHostPath: PROJECT_ROOT_HOST_PATH,
            configPathInContainer: DockerIntegrationConfigPathInContainer,
            startupTimeoutMs: DATA_PLANE_API_STARTUP_TIMEOUT_MS,
            bindMounts: [
              {
                source: CONFIG_FIXTURE_HOST_PATH,
                target: DockerIntegrationConfigPathInContainer,
                mode: "ro",
              },
              {
                source: DockerSocketPath,
                target: DockerSocketPath,
                mode: "rw",
              },
            ],
            environment: {
              MISTLE_TELEMETRY_ENABLED: "false",
              MISTLE_TELEMETRY_DEBUG: "false",
              MISTLE_INTERNAL_AUTH_SHARED_TOKEN: INTERNAL_AUTH_SERVICE_TOKEN,
              MISTLE_SANDBOX_PROVIDER: "docker",
              MISTLE_SANDBOX_DEFAULT_BASE_IMAGE: getLocalDevDockerRegistrySandboxBaseImageRef(),
              MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL: `ws://host.testcontainers.internal:${String(gatewayPort)}/tunnel/sandbox`,
              MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL: `ws://host.testcontainers.internal:${String(gatewayPort)}/tunnel/sandbox`,
              MISTLE_SANDBOX_TOKENS_CONNECT_SECRET: IntegrationConnectTokenSecret,
              MISTLE_SANDBOX_TOKENS_CONNECT_ISSUER: "integration-control-plane-api",
              MISTLE_SANDBOX_TOKENS_CONNECT_AUDIENCE: IntegrationTokenAudience,
              MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET: IntegrationBootstrapTokenSecret,
              MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER: IntegrationTokenIssuer,
              MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE: IntegrationTokenAudience,
              MISTLE_SANDBOX_TOKENS_EGRESS_SECRET: "integration-egress-token-secret",
              MISTLE_SANDBOX_TOKENS_EGRESS_ISSUER: "integration-data-plane-worker",
              MISTLE_SANDBOX_TOKENS_EGRESS_AUDIENCE: "integration-tokenizer-proxy",
              MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN: "mistle.example.test",
              MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET: "integration-publish-token-secret",
              MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER: "integration-control-plane-api",
              MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE: IntegrationTokenAudience,
              MISTLE_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET:
                "integration-publish-cookie-secret",
              MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: containerRuntimeDatabaseUrl,
              MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL: containerRuntimeDatabaseUrl,
              MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID: workflowNamespaceId,
              MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL: `http://host.testcontainers.internal:${String(gatewayPort)}`,
              MISTLE_SANDBOX_DOCKER_SOCKET_PATH: DockerSocketPath,
            },
          });
          cleanupTasks.unshift(async () => {
            await dataPlaneApi.stop();
          });

          const controlPlanePort = await reserveAvailablePort({ host: "127.0.0.1" });
          const controlPlaneApi = await startControlPlaneApiProcess({
            host: "127.0.0.1",
            port: controlPlanePort,
            databaseUrl: runtimeDatabaseUrl,
            dataPlaneApiBaseUrl: dataPlaneApi.hostBaseUrl,
            workflowNamespaceId,
            internalAuthServiceToken: INTERNAL_AUTH_SERVICE_TOKEN,
            sandboxStorageBackend: "archil",
            commitSignBinaryPath,
          });
          cleanupTasks.unshift(async () => {
            await controlPlaneApi.stop();
          });

          const runtimeConfig: DataPlaneGatewayRuntimeConfig = {
            app: {
              server: {
                host: "127.0.0.1",
                port: gatewayPort,
              },
              database: {
                url: runtimeDatabaseUrl,
              },
              runtimeState: createRuntimeStateConfig({
                backend,
                runtimeDatabaseName,
                valkeyUrl: sharedInfraConfig.valkeyUrl,
              }),
              dataPlaneApi: {
                baseUrl: dataPlaneApi.hostBaseUrl,
              },
              controlPlaneApi: {
                baseUrl: controlPlaneApi.baseUrl,
              },
              internalAuth: {
                serviceToken: INTERNAL_AUTH_SERVICE_TOKEN,
              },
              sandbox: {
                provider: "docker",
                defaultBaseImage: getLocalDevDockerRegistrySandboxBaseImageRef(),
                gatewayWsUrl: `ws://127.0.0.1:${String(gatewayPort)}/tunnel/sandbox`,
                internalGatewayWsUrl: `ws://127.0.0.1:${String(gatewayPort)}/tunnel/sandbox`,
                connect: {
                  tokenSecret: IntegrationConnectTokenSecret,
                  tokenIssuer: "integration-control-plane-api",
                  tokenAudience: IntegrationTokenAudience,
                },
                bootstrap: {
                  tokenSecret: IntegrationBootstrapTokenSecret,
                  tokenIssuer: IntegrationTokenIssuer,
                  tokenAudience: IntegrationTokenAudience,
                },
                egress: {
                  tokenSecret: "integration-egress-token-secret",
                  tokenIssuer: "integration-data-plane-worker",
                  tokenAudience: "integration-tokenizer-proxy",
                },
                publish: {
                  baseDomain: "mistle.example.test",
                  access: {
                    tokenSecret: "integration-publish-token-secret",
                    tokenIssuer: "integration-control-plane-api",
                    tokenAudience: IntegrationTokenAudience,
                  },
                  session: {
                    cookieSigningSecret: "integration-publish-cookie-secret",
                  },
                },
              },
              telemetry: {
                enabled: true,
                debug: false,
                traces: {
                  endpoint: `${otlpReceiver.url}/v1/traces`,
                },
                logs: {
                  endpoint: `${otlpReceiver.url}/v1/logs`,
                },
                metrics: {
                  endpoint: `${otlpReceiver.url}/v1/metrics`,
                },
                resourceAttributes: "deployment.environment=integration",
              },
            },
          };

          const runtime = createDataPlaneGatewayRuntime(runtimeConfig);
          await runtime.start();
          await waitForGatewayHealth({
            baseUrl: `http://${runtimeConfig.app.server.host}:${String(runtimeConfig.app.server.port)}`,
          });
          cleanupTasks.unshift(async () => {
            await runtime.stop();
          });
          cleanupTasks.push(async () => {
            await dropDatabaseIfExists({
              username: sharedInfraConfig.databaseUsername,
              password: sharedInfraConfig.databasePassword,
              host: sharedInfraConfig.databaseDirectHost,
              port: sharedInfraConfig.databaseDirectPort,
              databaseName: runtimeDatabaseName,
            });
          });

          await use({
            baseUrl: `http://${runtimeConfig.app.server.host}:${String(runtimeConfig.app.server.port)}`,
            websocketBaseUrl: `ws://${runtimeConfig.app.server.host}:${String(runtimeConfig.app.server.port)}`,
            config: runtimeConfig,
            controlPlaneBaseUrl: controlPlaneApi.baseUrl,
            controlPlaneDb,
            databaseStack: {
              directUrl: runtimeDatabaseUrl,
              pooledUrl: runtimeDatabaseUrl,
            },
            db,
            dbPool,
            internalAuthServiceToken: INTERNAL_AUTH_SERVICE_TOKEN,
            otlpRequests: otlpReceiver.requests,
            runtime,
            workflowNamespaceId,
          });
        } finally {
          await runCleanupTasks({
            tasks: cleanupTasks,
            context: "data-plane-gateway integration fixture cleanup",
          });
        }
      },
      {
        scope: "file",
      },
    ],
  });
}

export const it = createIntegrationIt("valkey");
export const itMemory = createIntegrationIt("memory");

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import { SandboxStorageBackend } from "@mistle/sandbox";
import {
  createIntegrationRuntimeScopeId,
  createIntegrationRuntimeDatabaseName,
  getCurrentVitestFilePath,
  readTestContext,
  reserveAvailablePort,
  runCleanupTasks,
} from "@mistle/test-harness";
import { systemClock, systemSleeper } from "@mistle/time";
import { Pool, Client } from "pg";
import { it as vitestIt } from "vitest";
import { z } from "zod";

import { createDataPlaneApiRuntime } from "../src/main.js";
import type { DataPlaneApiConfig } from "../src/types.js";

const RUNTIME_DATABASE_NAME_PREFIX = "mistle_data_plane_api_it_runtime";
const CONTROL_PLANE_RUNTIME_DATABASE_NAME_PREFIX = "mistle_control_plane_for_data_plane_api_it";
const TestContextId = "data-plane-api.integration";
const RepoRootPath = fileURLToPath(new URL("../../..", import.meta.url));
const ControlPlaneApiHealthcheckPath = "/__healthz";
const ControlPlaneApiStartupTimeoutMs = 20_000;
const ControlPlaneApiShutdownTimeoutMs = 5_000;
const ControlPlaneApiHealthPollIntervalMs = 100;

type ControlPlaneApiChildProcess = ChildProcessByStdio<null, Readable, Readable>;

type StartedControlPlaneApiProcess = {
  baseUrl: string;
  stop: () => Promise<void>;
};

export type DataPlaneApiIntegrationDatabaseStack = {
  directUrl: string;
  pooledUrl: string;
};

export type DataPlaneApiIntegrationFixture = {
  baseUrl: string;
  config: DataPlaneApiConfig;
  internalAuthServiceToken: string;
  databaseStack: DataPlaneApiIntegrationDatabaseStack;
  db: DataPlaneDatabase;
  controlPlaneDb: ControlPlaneDatabase;
  dbPool: Pool;
};

const SharedInfraConfigSchema = z
  .object({
    databaseUsername: z.string().min(1),
    databasePassword: z.string().min(1),
    databaseDirectHost: z.string().min(1),
    databaseDirectPort: z.number().int().min(1).max(65_535),
    templateDatabaseName: z.string().min(1),
    integrationRunId: z.string().min(1),
    workflowNamespaceId: z.string().min(1),
    internalAuthServiceToken: z.string().min(1),
  })
  .strict();

type SharedInfraConfig = z.infer<typeof SharedInfraConfigSchema>;

async function readSharedInfraConfig(): Promise<SharedInfraConfig> {
  return readTestContext({
    id: TestContextId,
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
  prefix?: string;
}): string {
  return createIntegrationRuntimeDatabaseName({
    prefix: input.prefix ?? RUNTIME_DATABASE_NAME_PREFIX,
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

async function createEmptyDatabase(input: {
  username: string;
  password: string;
  host: string;
  port: number;
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

  const quotedRuntimeDatabaseName = quoteIdentifier(
    assertSafeIdentifier(input.runtimeDatabaseName, "runtime database"),
  );

  await adminClient.connect();
  try {
    await adminClient.query(`DROP DATABASE IF EXISTS ${quotedRuntimeDatabaseName} WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE ${quotedRuntimeDatabaseName}`);
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

function createControlPlaneApiEnvironment(input: {
  host: string;
  port: number;
  databaseUrl: string;
  dataPlaneApiBaseUrl: string;
  workflowNamespaceId: string;
  internalAuthServiceToken: string;
  sandboxStorageBackend: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "development",
    NO_COLOR: "1",
    MISTLE_GLOBAL_TELEMETRY_ENABLED: "false",
    MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
    MISTLE_TEST_CONTROL_PLANE_API_HOST: input.host,
    MISTLE_TEST_CONTROL_PLANE_API_PORT: String(input.port),
    MISTLE_TEST_CONTROL_PLANE_API_DATABASE_URL: input.databaseUrl,
    MISTLE_TEST_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL: input.dataPlaneApiBaseUrl,
    MISTLE_TEST_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID: input.workflowNamespaceId,
    MISTLE_TEST_CONTROL_PLANE_API_INTERNAL_AUTH_SERVICE_TOKEN: input.internalAuthServiceToken,
    MISTLE_TEST_CONTROL_PLANE_API_SANDBOX_STORAGE_BACKEND: input.sandboxStorageBackend,
  };
}

function startControlPlaneApiChildProcess(input: {
  host: string;
  port: number;
  databaseUrl: string;
  dataPlaneApiBaseUrl: string;
  workflowNamespaceId: string;
  internalAuthServiceToken: string;
  sandboxStorageBackend: string;
}): ControlPlaneApiChildProcess {
  return spawn(
    "pnpm",
    ["exec", "tsx", "apps/data-plane-api/integration/helpers/start-control-plane-api.ts"],
    {
      cwd: RepoRootPath,
      env: createControlPlaneApiEnvironment(input),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function waitForControlPlaneApiHealth(input: {
  childProcess: ControlPlaneApiChildProcess;
  baseUrl: string;
  startupLogs: { stdout: string; stderr: string };
}): Promise<void> {
  const deadline = systemClock.nowMs() + ControlPlaneApiStartupTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    if (input.childProcess.exitCode !== null) {
      throw new Error(
        [
          `Control-plane-api process exited before becoming healthy with code ${String(input.childProcess.exitCode)}.`,
          input.startupLogs.stdout.length === 0 ? null : `stdout:\n${input.startupLogs.stdout}`,
          input.startupLogs.stderr.length === 0 ? null : `stderr:\n${input.startupLogs.stderr}`,
        ]
          .filter((part) => part !== null)
          .join("\n\n"),
      );
    }

    try {
      const response = await fetch(new URL(ControlPlaneApiHealthcheckPath, input.baseUrl));
      if (response.status === 200) {
        return;
      }
    } catch {}

    await systemSleeper.sleep(ControlPlaneApiHealthPollIntervalMs);
  }

  throw new Error(
    [
      `Timed out waiting for control-plane-api healthcheck at ${new URL(ControlPlaneApiHealthcheckPath, input.baseUrl).toString()}.`,
      input.startupLogs.stdout.length === 0 ? null : `stdout:\n${input.startupLogs.stdout}`,
      input.startupLogs.stderr.length === 0 ? null : `stderr:\n${input.startupLogs.stderr}`,
    ]
      .filter((part) => part !== null)
      .join("\n\n"),
  );
}

async function stopControlPlaneApiChildProcess(
  childProcess: ControlPlaneApiChildProcess,
): Promise<void> {
  if (childProcess.exitCode !== null) {
    return;
  }

  childProcess.kill("SIGTERM");

  const deadline = systemClock.nowMs() + ControlPlaneApiShutdownTimeoutMs;
  while (childProcess.exitCode === null && systemClock.nowMs() < deadline) {
    await systemSleeper.sleep(50);
  }

  if (childProcess.exitCode === null) {
    childProcess.kill("SIGKILL");
  }
}

async function startControlPlaneApiProcess(input: {
  host: string;
  port: number;
  databaseUrl: string;
  dataPlaneApiBaseUrl: string;
  workflowNamespaceId: string;
  internalAuthServiceToken: string;
  sandboxStorageBackend: string;
}): Promise<StartedControlPlaneApiProcess> {
  const baseUrl = `http://${input.host}:${String(input.port)}`;
  const childProcess = startControlPlaneApiChildProcess(input);
  const startupLogs = {
    stdout: "",
    stderr: "",
  };

  childProcess.stdout.setEncoding("utf8");
  childProcess.stderr.setEncoding("utf8");
  childProcess.stdout.on("data", (chunk: string) => {
    startupLogs.stdout += chunk;
  });
  childProcess.stderr.on("data", (chunk: string) => {
    startupLogs.stderr += chunk;
  });

  await waitForControlPlaneApiHealth({
    childProcess,
    baseUrl,
    startupLogs,
  });

  return {
    baseUrl,
    stop: async () => {
      await stopControlPlaneApiChildProcess(childProcess);
    },
  };
}

export const it = vitestIt.extend<{ fixture: DataPlaneApiIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const cleanupTasks: Array<() => Promise<void>> = [];
      const sharedInfraConfig = await readSharedInfraConfig();
      const runtimeDatabaseName = createFileScopedDatabaseName({
        integrationRunId: sharedInfraConfig.integrationRunId,
        filePath: getCurrentVitestFilePath(),
        scopeId: createIntegrationRuntimeScopeId(),
      });
      const controlPlaneRuntimeDatabaseName = createFileScopedDatabaseName({
        integrationRunId: sharedInfraConfig.integrationRunId,
        filePath: getCurrentVitestFilePath(),
        scopeId: createIntegrationRuntimeScopeId(),
        prefix: CONTROL_PLANE_RUNTIME_DATABASE_NAME_PREFIX,
      });

      try {
        await resetWorkerDatabaseFromTemplate({
          username: sharedInfraConfig.databaseUsername,
          password: sharedInfraConfig.databasePassword,
          host: sharedInfraConfig.databaseDirectHost,
          port: sharedInfraConfig.databaseDirectPort,
          templateDatabaseName: sharedInfraConfig.templateDatabaseName,
          runtimeDatabaseName,
        });
        await createEmptyDatabase({
          username: sharedInfraConfig.databaseUsername,
          password: sharedInfraConfig.databasePassword,
          host: sharedInfraConfig.databaseDirectHost,
          port: sharedInfraConfig.databaseDirectPort,
          runtimeDatabaseName: controlPlaneRuntimeDatabaseName,
        });

        const runtimeDatabaseUrl = createDatabaseUrl({
          username: sharedInfraConfig.databaseUsername,
          password: sharedInfraConfig.databasePassword,
          host: sharedInfraConfig.databaseDirectHost,
          port: sharedInfraConfig.databaseDirectPort,
          databaseName: runtimeDatabaseName,
        });
        const controlPlaneRuntimeDatabaseUrl = createDatabaseUrl({
          username: sharedInfraConfig.databaseUsername,
          password: sharedInfraConfig.databasePassword,
          host: sharedInfraConfig.databaseDirectHost,
          port: sharedInfraConfig.databaseDirectPort,
          databaseName: controlPlaneRuntimeDatabaseName,
        });

        const dbPool = new Pool({
          connectionString: runtimeDatabaseUrl,
        });
        cleanupTasks.unshift(async () => {
          await dbPool.end();
        });
        const db = createDataPlaneDatabase(dbPool);
        await runControlPlaneMigrations({
          connectionString: controlPlaneRuntimeDatabaseUrl,
          schemaName: "control_plane",
          migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
          migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
          migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
        });
        const controlPlaneDbPool = new Pool({
          connectionString: controlPlaneRuntimeDatabaseUrl,
        });
        cleanupTasks.unshift(async () => {
          await controlPlaneDbPool.end();
        });
        const controlPlaneDb = createControlPlaneDatabase(controlPlaneDbPool);
        const controlPlanePort = await reserveAvailablePort({ host: "127.0.0.1" });

        const config: DataPlaneApiConfig = {
          server: {
            host: "127.0.0.1",
            port: await reserveAvailablePort({ host: "127.0.0.1" }),
          },
          database: {
            url: runtimeDatabaseUrl,
            migrationUrl: runtimeDatabaseUrl,
          },
          workflow: {
            databaseUrl: runtimeDatabaseUrl,
            namespaceId: sharedInfraConfig.workflowNamespaceId,
          },
          runtimeState: {
            gatewayBaseUrl: `http://127.0.0.1:${String(
              await reserveAvailablePort({ host: "127.0.0.1" }),
            )}`,
          },
          controlPlaneApi: {
            baseUrl: `http://127.0.0.1:${String(controlPlanePort)}`,
          },
          sandbox: {
            docker: {
              socketPath: "/var/run/docker.sock",
            },
          },
        };
        const controlPlaneRuntime = await startControlPlaneApiProcess({
          host: "127.0.0.1",
          port: controlPlanePort,
          databaseUrl: controlPlaneRuntimeDatabaseUrl,
          dataPlaneApiBaseUrl: `http://${config.server.host}:${String(config.server.port)}`,
          workflowNamespaceId: sharedInfraConfig.workflowNamespaceId,
          internalAuthServiceToken: sharedInfraConfig.internalAuthServiceToken,
          sandboxStorageBackend: SandboxStorageBackend.ARCHIL,
        });
        cleanupTasks.unshift(async () => {
          await controlPlaneRuntime.stop();
        });

        const runtime = await createDataPlaneApiRuntime({
          app: config,
          internalAuthServiceToken: sharedInfraConfig.internalAuthServiceToken,
          sandboxProvider: "docker",
          sandboxStorageBackend: "archil",
        });
        await runtime.start();
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
          await dropDatabaseIfExists({
            username: sharedInfraConfig.databaseUsername,
            password: sharedInfraConfig.databasePassword,
            host: sharedInfraConfig.databaseDirectHost,
            port: sharedInfraConfig.databaseDirectPort,
            databaseName: controlPlaneRuntimeDatabaseName,
          });
        });

        await use({
          baseUrl: `http://${config.server.host}:${String(config.server.port)}`,
          config,
          internalAuthServiceToken: sharedInfraConfig.internalAuthServiceToken,
          databaseStack: {
            directUrl: runtimeDatabaseUrl,
            pooledUrl: runtimeDatabaseUrl,
          },
          db,
          controlPlaneDb,
          dbPool,
        });
      } finally {
        await runCleanupTasks({
          tasks: cleanupTasks,
          context: "data-plane-api integration fixture cleanup",
        });
      }
    },
    {
      scope: "file",
    },
  ],
});

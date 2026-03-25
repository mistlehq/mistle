import { randomUUID } from "node:crypto";

import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { reserveAvailablePort } from "@mistle/test-harness";
import { systemSleeper } from "@mistle/time";
import { Client, Pool } from "pg";

import { createDataPlaneApiRuntime } from "../../../data-plane-api/src/main.js";
import {
  closeWebSocket,
  connectBootstrapSocket,
  mintValidBootstrapToken,
  startGatewayProcess,
  type StartedGatewayProcess,
} from "../../../data-plane-api/integration/runtime-status-test-helpers.js";
import { createDataPlaneBackend } from "../../../data-plane-api/src/openworkflow/index.js";
import type { DataPlaneApiConfig } from "../../../data-plane-api/src/types.js";

export type DisposableDataPlaneRuntime = {
  baseUrl: string;
  db: DataPlaneDatabase;
  dbPool: Pool;
  attachSandboxRuntime: (input: { sandboxInstanceId: string }) => Promise<void>;
  stop: () => Promise<void>;
};

const RuntimeAttachmentReadyTimeoutMs = 5_000;
const RuntimeAttachmentReadyPollIntervalMs = 50;

type RuntimeStateSnapshot = {
  ownerLeaseId: string | null;
  attachment: {
    sandboxInstanceId: string;
    ownerLeaseId: string;
  } | null;
};

function isRuntimeStateSnapshot(value: unknown): value is RuntimeStateSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const ownerLeaseId = Object.getOwnPropertyDescriptor(value, "ownerLeaseId")?.value;
  const attachment = Object.getOwnPropertyDescriptor(value, "attachment")?.value;
  if (ownerLeaseId !== null && typeof ownerLeaseId !== "string") {
    return false;
  }
  if (attachment === null) {
    return true;
  }
  if (typeof attachment !== "object" || attachment === null) {
    return false;
  }

  const sandboxInstanceId = Object.getOwnPropertyDescriptor(attachment, "sandboxInstanceId")?.value;
  const attachmentOwnerLeaseId = Object.getOwnPropertyDescriptor(attachment, "ownerLeaseId")?.value;
  return typeof sandboxInstanceId === "string" && typeof attachmentOwnerLeaseId === "string";
}

async function waitForRuntimeAttachment(input: {
  gateway: StartedGatewayProcess;
  internalAuthServiceToken: string;
  sandboxInstanceId: string;
}): Promise<void> {
  const deadline = Date.now() + RuntimeAttachmentReadyTimeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(
      new URL(
        `/internal/sandbox-instances/${encodeURIComponent(input.sandboxInstanceId)}/runtime-state`,
        input.gateway.baseUrl,
      ),
      {
        headers: {
          "x-mistle-service-token": input.internalAuthServiceToken,
        },
      },
    );
    if (!response.ok) {
      throw new Error(
        `Expected runtime-state route to respond successfully for sandbox '${input.sandboxInstanceId}', got status ${String(response.status)}.`,
      );
    }

    const payload: unknown = await response.json();
    if (!isRuntimeStateSnapshot(payload)) {
      throw new Error("Runtime-state response payload is invalid.");
    }

    if (
      payload.ownerLeaseId !== null &&
      payload.attachment?.sandboxInstanceId === input.sandboxInstanceId &&
      payload.attachment.ownerLeaseId === payload.ownerLeaseId
    ) {
      return;
    }

    await systemSleeper.sleep(RuntimeAttachmentReadyPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for runtime attachment for sandbox '${input.sandboxInstanceId}'.`,
  );
}

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

export async function createDisposableDataPlaneRuntime(input: {
  controlPlaneDatabaseUrl: string;
  internalAuthServiceToken: string;
  workflowNamespaceId: string;
  databaseNamePrefix: string;
  baseUrl: string;
}): Promise<DisposableDataPlaneRuntime> {
  const adminConnection = parseDatabaseConnectionString(input.controlPlaneDatabaseUrl);
  const databaseName = `${input.databaseNamePrefix}_${randomUUID().replaceAll("-", "_")}`;
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
  let gateway: StartedGatewayProcess | undefined;
  let dbPool: Pool | undefined;
  const connectedBootstrapSockets: Array<{ close: () => Promise<void> }> = [];

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

    const configuredBaseUrl = new URL(input.baseUrl);
    const host = configuredBaseUrl.hostname;
    const configuredPort = Number(configuredBaseUrl.port);
    const port =
      Number.isInteger(configuredPort) && configuredPort > 0
        ? configuredPort
        : await reserveAvailablePort({ host });
    const gatewayPort = await reserveAvailablePort({ host });
    const config: DataPlaneApiConfig = {
      server: {
        host,
        port,
      },
      database: {
        url: databaseUrl,
        migrationUrl: databaseUrl,
      },
      workflow: {
        databaseUrl,
        namespaceId: input.workflowNamespaceId,
      },
      runtimeState: {
        gatewayBaseUrl: `http://${host}:${String(gatewayPort)}`,
      },
    };

    runtime = await createDataPlaneApiRuntime({
      app: config,
      internalAuthServiceToken: input.internalAuthServiceToken,
      sandboxProvider: "docker",
    });
    await runtime.start();
    gateway = await startGatewayProcess({
      port: gatewayPort,
      databaseUrl,
      dataPlaneApiBaseUrl: `http://${host}:${String(port)}`,
      internalAuthServiceToken: input.internalAuthServiceToken,
    });

    return {
      baseUrl: `${configuredBaseUrl.protocol}//${host}:${String(port)}`,
      db: createDataPlaneDatabase(dbPool),
      dbPool,
      attachSandboxRuntime: async ({ sandboxInstanceId }) => {
        if (gateway === undefined) {
          throw new Error("Expected gateway to be started before attaching sandbox runtime.");
        }

        const token = await mintValidBootstrapToken({
          sandboxInstanceId,
        });
        const socket = await connectBootstrapSocket({
          websocketBaseUrl: gateway.websocketBaseUrl,
          sandboxInstanceId,
          token,
        });
        connectedBootstrapSockets.push({
          close: async () => {
            await closeWebSocket(socket);
          },
        });

        await waitForRuntimeAttachment({
          gateway,
          internalAuthServiceToken: input.internalAuthServiceToken,
          sandboxInstanceId,
        });
      },
      stop: async () => {
        while (connectedBootstrapSockets.length > 0) {
          const connectedSocket = connectedBootstrapSockets.pop();
          if (connectedSocket !== undefined) {
            await connectedSocket.close();
          }
        }
        if (gateway !== undefined) {
          await gateway.stop();
        }
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
    while (connectedBootstrapSockets.length > 0) {
      const connectedSocket = connectedBootstrapSockets.pop();
      if (connectedSocket !== undefined) {
        await connectedSocket.close().catch(() => undefined);
      }
    }
    if (gateway !== undefined) {
      await gateway.stop();
    }
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

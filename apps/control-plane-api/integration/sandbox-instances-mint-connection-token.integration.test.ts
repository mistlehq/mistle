import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import {
  SandboxInstanceSources,
  SandboxInstanceStarterKinds,
  SandboxInstanceStatuses,
  createDataPlaneDatabase,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import {
  reserveAvailablePort,
  startPostgresWithPgBouncer,
  type PostgresWithPgBouncerService,
} from "@mistle/test-core";
import { verifyBootstrapToken } from "@mistle/tunnel-auth";
import { createDataPlaneBackend } from "@mistle/workflows/data-plane";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDataPlaneApiRuntime } from "../../data-plane-api/src/runtime/index.js";
import type { DataPlaneApiConfig } from "../../data-plane-api/src/types.js";
import {
  SandboxInstancesConflictCodes,
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
  createSandboxInstancesService,
} from "../src/sandbox-instances/index.js";

const TokenConfig = {
  bootstrapTokenSecret: "integration-bootstrap-secret",
  tokenIssuer: "integration-control-plane",
  tokenAudience: "integration-data-plane-gateway",
} as const;

const GatewayWebsocketUrl = "wss://gateway.example.test/tunnel/client";
const InternalAuthServiceToken = "integration-service-token";
const WorkflowNamespaceId = "integration";

describe("sandbox instances service mintConnectionToken", () => {
  let databaseStack: PostgresWithPgBouncerService;
  let dataPlaneDbPool: Pool;
  let dataPlaneDb: DataPlaneDatabase;
  let dataPlaneRuntime: Awaited<ReturnType<typeof createDataPlaneApiRuntime>> | undefined;
  let dataPlaneBaseUrl: string;

  beforeAll(async () => {
    databaseStack = await startPostgresWithPgBouncer({
      databaseName: "mistle_control_plane_sandbox_instances_service_integration",
    });

    await runDataPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
    });

    dataPlaneDbPool = new Pool({
      connectionString: databaseStack.pooledUrl,
    });
    dataPlaneDb = createDataPlaneDatabase(dataPlaneDbPool);

    const dataPlaneMigrationBackend = await createDataPlaneBackend({
      url: databaseStack.directUrl,
      namespaceId: WorkflowNamespaceId,
      runMigrations: true,
    });
    await dataPlaneMigrationBackend.stop();

    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const dataPlaneConfig: DataPlaneApiConfig = {
      server: {
        host,
        port,
      },
      database: {
        url: databaseStack.pooledUrl,
      },
      workflow: {
        databaseUrl: databaseStack.pooledUrl,
        namespaceId: WorkflowNamespaceId,
      },
    };
    dataPlaneBaseUrl = `http://${host}:${String(port)}`;
    dataPlaneRuntime = await createDataPlaneApiRuntime({
      app: dataPlaneConfig,
      internalAuthServiceToken: InternalAuthServiceToken,
    });
    await dataPlaneRuntime.start();
  });

  beforeEach(async () => {
    await dataPlaneDb.delete(sandboxInstances);
  });

  afterAll(async () => {
    await Promise.all([
      dataPlaneRuntime?.stop() ?? Promise.resolve(),
      dataPlaneDbPool.end(),
      databaseStack.stop(),
    ]);
  });

  it("mints a connection token for a running sandbox instance", async () => {
    const organizationId = "org_running";
    const sandboxInstanceId = "sbi_running";

    await dataPlaneDb.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId,
      sandboxProfileId: "sbp_profile",
      sandboxProfileVersion: 1,
      provider: "docker",
      providerSandboxId: "provider-running",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: SandboxInstanceStarterKinds.USER,
      startedById: "usr_1",
      source: SandboxInstanceSources.DASHBOARD,
      startedAt: new Date().toISOString(),
    });

    const sandboxInstancesService = createSandboxInstancesService({
      dataPlaneClient: createDataPlaneSandboxInstancesClient({
        baseUrl: dataPlaneBaseUrl,
        serviceToken: InternalAuthServiceToken,
      }),
    });

    const tokenResponse = await sandboxInstancesService.mintConnectionToken({
      organizationId,
      instanceId: sandboxInstanceId,
      gatewayWebsocketUrl: GatewayWebsocketUrl,
      tokenTtlSeconds: 90,
      tokenConfig: TokenConfig,
    });

    expect(tokenResponse.instanceId).toBe(sandboxInstanceId);
    expect(tokenResponse.token.length).toBeGreaterThan(0);

    const parsedConnectionUrl = new URL(tokenResponse.url);
    expect(parsedConnectionUrl.origin).toBe("wss://gateway.example.test");
    expect(parsedConnectionUrl.pathname).toBe("/tunnel/client");
    expect(parsedConnectionUrl.searchParams.get("token")).toBe(tokenResponse.token);

    const verifiedToken = await verifyBootstrapToken({
      config: TokenConfig,
      token: tokenResponse.token,
    });
    expect(verifiedToken.jti.length).toBeGreaterThan(0);

    expect(new Date(tokenResponse.expiresAt).toString()).not.toBe("Invalid Date");
  });

  it("throws not found when the sandbox instance does not exist", async () => {
    const sandboxInstancesService = createSandboxInstancesService({
      dataPlaneClient: createDataPlaneSandboxInstancesClient({
        baseUrl: dataPlaneBaseUrl,
        serviceToken: InternalAuthServiceToken,
      }),
    });

    await expect(
      sandboxInstancesService.mintConnectionToken({
        organizationId: "org_missing",
        instanceId: "sbi_missing",
        gatewayWebsocketUrl: GatewayWebsocketUrl,
        tokenTtlSeconds: 90,
        tokenConfig: TokenConfig,
      }),
    ).rejects.toMatchObject({
      name: SandboxInstancesNotFoundError.name,
      code: SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
    });
  });

  it("throws conflict when the sandbox instance is not running", async () => {
    const organizationId = "org_starting";
    const sandboxInstanceId = "sbi_starting";

    await dataPlaneDb.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId,
      sandboxProfileId: "sbp_profile",
      sandboxProfileVersion: 1,
      provider: "docker",
      providerSandboxId: "provider-starting",
      status: SandboxInstanceStatuses.STARTING,
      startedByKind: SandboxInstanceStarterKinds.USER,
      startedById: "usr_2",
      source: SandboxInstanceSources.DASHBOARD,
    });

    const sandboxInstancesService = createSandboxInstancesService({
      dataPlaneClient: createDataPlaneSandboxInstancesClient({
        baseUrl: dataPlaneBaseUrl,
        serviceToken: InternalAuthServiceToken,
      }),
    });

    await expect(
      sandboxInstancesService.mintConnectionToken({
        organizationId,
        instanceId: sandboxInstanceId,
        gatewayWebsocketUrl: GatewayWebsocketUrl,
        tokenTtlSeconds: 90,
        tokenConfig: TokenConfig,
      }),
    ).rejects.toMatchObject({
      name: SandboxInstancesConflictError.name,
      code: SandboxInstancesConflictCodes.INSTANCE_NOT_RUNNING,
    });
  });
});

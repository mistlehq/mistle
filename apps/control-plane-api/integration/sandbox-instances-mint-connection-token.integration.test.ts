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
import { startPostgresWithPgBouncer, type PostgresWithPgBouncerService } from "@mistle/test-core";
import { verifyBootstrapToken } from "@mistle/tunnel-auth";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

describe("sandbox instances service mintConnectionToken", () => {
  let databaseStack: PostgresWithPgBouncerService;
  let dataPlaneDbPool: Pool;
  let dataPlaneDb: DataPlaneDatabase;

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
  });

  beforeEach(async () => {
    await dataPlaneDb.delete(sandboxInstances);
  });

  afterAll(async () => {
    await Promise.all([dataPlaneDbPool.end(), databaseStack.stop()]);
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
      dataPlaneDb,
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
      dataPlaneDb,
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
      dataPlaneDb,
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

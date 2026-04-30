import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";

import {
  createServiceRegistry,
  startPostgresWithPgBouncer,
  startTestEnvironment,
  startValkey,
  type PostgresWithPgBouncerService,
  type ResolvedTestInfra,
  type TestService,
  type TestInfraProvisioner,
  type TestInfraRequirement,
  type TestServiceDefinition,
  type TestServiceRuntime,
  type ValkeyService,
} from "@mistle/test-harness";
import { afterEach, describe, expect, it } from "vitest";

type StartedHttpService = TestService;

const EnvironmentCount = 4;
const PostgresTableInfraId = "postgres.state-table";
const ValkeyPrefixInfraId = "valkey.state-prefix";
const StatefulParallelTestTimeoutMs = 180_000;

const startedEnvironments: Awaited<ReturnType<typeof startTestEnvironment>>[] = [];

function createSharedPostgresTableProvisioner(): TestInfraProvisioner {
  let postgresPromise: Promise<PostgresWithPgBouncerService> | undefined;
  let activeLeases = 0;

  const getPostgres = (): Promise<PostgresWithPgBouncerService> => {
    if (postgresPromise === undefined) {
      // The environment owns cleanup for this spike, so the lower-level launcher
      // should not also register process cleanup for the shared physical stack.
      postgresPromise = startPostgresWithPgBouncer({
        manageProcessCleanup: false,
        containerLabels: {
          "mistle.test.environment-spike": "stateful-parallel-postgres",
        },
      });
    }

    return postgresPromise;
  };

  const releasePostgres = async (): Promise<void> => {
    activeLeases -= 1;
    if (activeLeases > 0 || postgresPromise === undefined) {
      return;
    }

    const postgres = await postgresPromise;
    postgresPromise = undefined;
    await postgres.stop();
  };

  return {
    kind: "postgres-table",
    provision: async (input) => {
      const postgres = await getPostgres();
      const resolvedInfra: ResolvedTestInfra[] = [];

      for (const requirement of input.requirements) {
        activeLeases += 1;
        const tableName = createPostgresTableName(input.environmentId, requirement.id);
        await runPostgresSql({
          postgres,
          sql: [
            `CREATE TABLE ${tableName} (id text PRIMARY KEY, value text NOT NULL)`,
            `INSERT INTO ${tableName} (id, value) VALUES ('environment', ${sqlStringLiteral(
              input.environmentId,
            )})`,
          ].join("; "),
        });

        let stopped = false;
        resolvedInfra.push({
          id: requirement.id,
          kind: requirement.kind,
          values: new Map([
            ["containerId", postgres.runtimeMetadata.postgresContainerId],
            ["databaseName", postgres.postgres.databaseName],
            ["tableName", tableName],
          ]),
          stop: async () => {
            if (stopped) {
              return;
            }

            stopped = true;
            try {
              await runPostgresSql({
                postgres,
                sql: `DROP TABLE IF EXISTS ${tableName}`,
              });
            } finally {
              await releasePostgres();
            }
          },
        });
      }

      return resolvedInfra;
    },
  };
}

function createSharedValkeyPrefixProvisioner(): TestInfraProvisioner {
  let valkeyPromise: Promise<ValkeyService> | undefined;
  let activeLeases = 0;

  const getValkey = (): Promise<ValkeyService> => {
    if (valkeyPromise === undefined) {
      // The test environment handle is the single owner of cleanup. That keeps
      // forgotten env.stop() and explicit env.stop() on the same path.
      valkeyPromise = startValkey({
        manageProcessCleanup: false,
        containerLabels: {
          "mistle.test.environment-spike": "stateful-parallel-valkey",
        },
      });
    }

    return valkeyPromise;
  };

  const releaseValkey = async (): Promise<void> => {
    activeLeases -= 1;
    if (activeLeases > 0 || valkeyPromise === undefined) {
      return;
    }

    const valkey = await valkeyPromise;
    valkeyPromise = undefined;
    await valkey.stop();
  };

  return {
    kind: "valkey-prefix",
    provision: async (input) => {
      const valkey = await getValkey();
      const resolvedInfra: ResolvedTestInfra[] = [];

      for (const requirement of input.requirements) {
        activeLeases += 1;
        const keyPrefix = `state:${input.environmentId}:${requirement.id}:`;
        const markerKey = `${keyPrefix}environment`;
        await runValkeyCommand({
          valkey,
          args: ["SET", markerKey, input.environmentId],
        });

        let stopped = false;
        resolvedInfra.push({
          id: requirement.id,
          kind: requirement.kind,
          values: new Map([
            ["containerId", valkey.runtimeMetadata.containerId],
            ["keyPrefix", keyPrefix],
            ["markerKey", markerKey],
          ]),
          stop: async () => {
            if (stopped) {
              return;
            }

            stopped = true;
            try {
              await runValkeyCommand({
                valkey,
                args: ["DEL", markerKey],
              });
            } finally {
              await releaseValkey();
            }
          },
        });
      }

      return resolvedInfra;
    },
  };
}

function createPostgresTableRequirement(provisioner: TestInfraProvisioner): TestInfraRequirement {
  return {
    id: PostgresTableInfraId,
    kind: "postgres-table",
    provisioner,
  };
}

function createValkeyPrefixRequirement(provisioner: TestInfraProvisioner): TestInfraRequirement {
  return {
    id: ValkeyPrefixInfraId,
    kind: "valkey-prefix",
    provisioner,
  };
}

async function startHttpStateService(input: {
  environmentId: string;
  infra: ReadonlyMap<string, ResolvedTestInfra>;
}): Promise<StartedHttpService> {
  const postgresTable = getInfra(input.infra, PostgresTableInfraId);
  const valkeyPrefix = getInfra(input.infra, ValkeyPrefixInfraId);
  const postgresContainerId = readStringValue(postgresTable, "containerId");
  const postgresDatabaseName = readStringValue(postgresTable, "databaseName");
  const postgresTableName = readStringValue(postgresTable, "tableName");
  const valkeyContainerId = readStringValue(valkeyPrefix, "containerId");
  const valkeyMarkerKey = readStringValue(valkeyPrefix, "markerKey");

  const server = createServer(async (_request, response) => {
    try {
      const postgresMarker = await runPostgresSqlInContainer({
        containerId: postgresContainerId,
        databaseName: postgresDatabaseName,
        sql: `SELECT value FROM ${postgresTableName} WHERE id = 'environment'`,
      });
      const valkeyMarker = await runDockerExec([
        valkeyContainerId,
        "valkey-cli",
        "GET",
        valkeyMarkerKey,
      ]);

      response.writeHead(200, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          environmentId: input.environmentId,
          postgresMarker,
          valkeyMarker,
        }),
      );
    } catch (error) {
      response.writeHead(500, {
        "content-type": "text/plain",
      });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Expected stateful HTTP service to listen on a TCP port.");
  }

  return {
    id: "stateful-http-service",
    mode: "runtime",
    endpoints: {
      http: {
        hostBaseUrl: `http://127.0.0.1:${String(address.port)}`,
      },
    },
    stop: async () => {
      await closeServer(server);
    },
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function getInfra(
  infra: ReadonlyMap<string, ResolvedTestInfra>,
  infraId: string,
): ResolvedTestInfra {
  const resolvedInfra = infra.get(infraId);
  if (resolvedInfra === undefined) {
    throw new Error(`Missing resolved infra '${infraId}'.`);
  }

  return resolvedInfra;
}

function readStringValue(infra: ResolvedTestInfra, key: string): string {
  const value = infra.values.get(key);
  if (value === undefined) {
    throw new Error(`Missing ${infra.id} value '${key}'.`);
  }

  return value;
}

function createPostgresTableName(environmentId: string, requirementId: string): string {
  const sanitizedRequirementId = requirementId.replaceAll(/[^a-z0-9_]/g, "_");
  const tableName = `state_${environmentId}_${sanitizedRequirementId}`;
  if (!/^[a-z0-9_]+$/.test(tableName)) {
    throw new Error(`Cannot use '${tableName}' as a Postgres table name.`);
  }

  return tableName;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function runPostgresSql(input: {
  postgres: PostgresWithPgBouncerService;
  sql: string;
}): Promise<string> {
  return runPostgresSqlInContainer({
    containerId: input.postgres.runtimeMetadata.postgresContainerId,
    databaseName: input.postgres.postgres.databaseName,
    sql: input.sql,
  });
}

async function runPostgresSqlInContainer(input: {
  containerId: string;
  databaseName: string;
  sql: string;
}): Promise<string> {
  return runDockerExec([
    input.containerId,
    "psql",
    "-U",
    "mistle",
    "-d",
    input.databaseName,
    "-tA",
    "-c",
    input.sql,
  ]);
}

async function runValkeyCommand(input: {
  valkey: ValkeyService;
  args: readonly string[];
}): Promise<string> {
  return runDockerExec([input.valkey.runtimeMetadata.containerId, "valkey-cli", ...input.args]);
}

function runDockerExec(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      ["exec", ...args],
      {
        encoding: "utf8",
        timeout: 30_000,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(stderr.length > 0 ? stderr : error.message));
          return;
        }

        resolve(stdout.trim());
      },
    );
  });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Expected ${url} to return OK, received ${String(response.status)}.`);
  }

  return response.json();
}

function readHostBaseUrl(service: TestServiceRuntime): string {
  const httpEndpoint = service.endpoints.http;
  if (httpEndpoint === undefined) {
    throw new Error("Expected stateful HTTP service to expose an HTTP endpoint.");
  }

  return httpEndpoint.hostBaseUrl;
}

async function checkHttpHealth(service: TestServiceRuntime): Promise<void> {
  const response = await fetch(readHostBaseUrl(service));
  if (!response.ok) {
    throw new Error("Expected stateful HTTP service health check to return OK.");
  }
}

function assertStatePayload(value: unknown): asserts value is {
  environmentId: string;
  postgresMarker: string;
  valkeyMarker: string;
} {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected state payload to be an object.");
  }

  const environmentId = Reflect.get(value, "environmentId");
  const postgresMarker = Reflect.get(value, "postgresMarker");
  const valkeyMarker = Reflect.get(value, "valkeyMarker");
  if (
    typeof environmentId !== "string" ||
    typeof postgresMarker !== "string" ||
    typeof valkeyMarker !== "string"
  ) {
    throw new Error(
      "Expected state payload to contain string environmentId, postgresMarker, and valkeyMarker.",
    );
  }
}

describe("parallel test environments with stateful infra", () => {
  afterEach(async () => {
    const environments = startedEnvironments.splice(0, startedEnvironments.length);
    await Promise.all(environments.map(async (environment) => environment.stop()));
  });

  it(
    "isolates logical Postgres and Valkey state while sharing physical containers",
    async () => {
      const postgresProvisioner = createSharedPostgresTableProvisioner();
      const valkeyProvisioner = createSharedValkeyPrefixProvisioner();
      const postgresRequirement = createPostgresTableRequirement(postgresProvisioner);
      const valkeyRequirement = createValkeyPrefixRequirement(valkeyProvisioner);
      const registry = createServiceRegistry({
        services: {
          "stateful-http-service": {
            id: "stateful-http-service",
            infra: [postgresRequirement, valkeyRequirement],
            serviceReferences: [],
            supportedModes: ["runtime"],
            healthCheck: checkHttpHealth,
            start: async (input) =>
              startHttpStateService({
                environmentId: input.environmentId,
                infra: input.infra,
              }),
          } satisfies TestServiceDefinition,
        },
        __dangerouslyIsolatedServices: {
          reason: "This test proves per-environment logical state isolation.",
        },
      });

      const environments = await Promise.all(
        Array.from({ length: EnvironmentCount }, async () =>
          startTestEnvironment({
            registry,
            services: [{ service: "stateful-http-service", mode: "runtime" }],
          }),
        ),
      );
      startedEnvironments.push(...environments);

      const postgresContainerIds = new Set<string>();
      const valkeyContainerIds = new Set<string>();
      const postgresTables = new Set<string>();
      const valkeyPrefixes = new Set<string>();

      await Promise.all(
        environments.map(async (environment) => {
          const service = environment.services.get("stateful-http-service");

          const postgresTable = getInfra(environment.infra, PostgresTableInfraId);
          const valkeyPrefix = getInfra(environment.infra, ValkeyPrefixInfraId);
          postgresContainerIds.add(readStringValue(postgresTable, "containerId"));
          valkeyContainerIds.add(readStringValue(valkeyPrefix, "containerId"));
          postgresTables.add(readStringValue(postgresTable, "tableName"));
          valkeyPrefixes.add(readStringValue(valkeyPrefix, "keyPrefix"));

          const payload = await fetchJson(readHostBaseUrl(service));
          assertStatePayload(payload);
          expect(payload.environmentId).toBe(environment.id);
          expect(payload.postgresMarker).toBe(environment.id);
          expect(payload.valkeyMarker).toBe(environment.id);
        }),
      );

      expect(postgresContainerIds.size).toBe(1);
      expect(valkeyContainerIds.size).toBe(1);
      expect(postgresTables.size).toBe(EnvironmentCount);
      expect(valkeyPrefixes.size).toBe(EnvironmentCount);
    },
    StatefulParallelTestTimeoutMs,
  );
});

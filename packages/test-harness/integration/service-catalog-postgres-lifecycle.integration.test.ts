import { randomUUID } from "node:crypto";
import { Socket } from "node:net";

import {
  createTestRegistry,
  drainProcessCleanupTasks,
  MISTLE_TEST_POOLING_ENV,
  MISTLE_TEST_RUN_ID_ENV,
  MISTLE_TEST_RUN_OWNER_PID_ENV,
} from "@mistle/test-harness";
import { Client } from "pg";
import { createClient } from "redis";
import { afterEach, describe, expect, it } from "vitest";

import { stopSharedInfraForTestRun } from "../src/services/shared-infra-coordinator.js";

const PostgresInfraId = "postgres";
const ValkeyInfraId = "valkey";
const HostDirectUrlValue = "host.directUrl";
const HostUrlValue = "host.url";
const DataPlaneSchemaNameValue = "schema.dataPlane";
const KeyPrefixValue = "keyPrefix";
const TestTimeoutMs = 120_000;

const logicalInfraStops: Array<() => Promise<void>> = [];
const sharedInfraRunIds: string[] = [];

function readValue(input: {
  values: ReadonlyMap<string, string>;
  key: string;
  label: string;
}): string {
  const value = input.values.get(input.key);
  if (value === undefined) {
    throw new Error(`Expected ${input.label} to expose '${input.key}'.`);
  }

  return value;
}

describe("Mistle test catalog Postgres lifecycle", () => {
  afterEach(async () => {
    const stops = logicalInfraStops.splice(0, logicalInfraStops.length);
    await Promise.all(stops.map(async (stop) => stop()));
    const runIds = sharedInfraRunIds.splice(0, sharedInfraRunIds.length);
    await Promise.all(runIds.map(async (runId) => stopSharedInfraForTestRun(runId)));
    await drainProcessCleanupTasks("service catalog Postgres lifecycle cleanup");
  });

  it(
    "reuses one physical Postgres lease while provisioning isolated schemas concurrently",
    async () => {
      const registry = createTestRegistry({
        sharedInfraKey: `postgres-lifecycle-${randomUUID()}`,
      });
      const requirement = registry["data-plane-api"].infra.find(
        (candidate) => candidate.id === PostgresInfraId,
      );
      if (requirement === undefined) {
        throw new Error("Expected data-plane-api to require Postgres.");
      }

      const [first, second] = await Promise.all([
        requirement.provisioner.provision({
          environmentId: "test_env_postgres_lifecycle_a",
          requirements: [requirement],
        }),
        requirement.provisioner.provision({
          environmentId: "test_env_postgres_lifecycle_b",
          requirements: [requirement],
        }),
      ]);
      const firstInfra = first[0];
      const secondInfra = second[0];
      if (firstInfra === undefined || secondInfra === undefined) {
        throw new Error("Expected Postgres provisioner to resolve both logical resources.");
      }
      logicalInfraStops.push(firstInfra.stop, secondInfra.stop);

      expect(
        readValue({
          values: firstInfra.values,
          key: HostDirectUrlValue,
          label: "first Postgres infra",
        }),
      ).toBe(
        readValue({
          values: secondInfra.values,
          key: HostDirectUrlValue,
          label: "second Postgres infra",
        }),
      );
      expect(
        readValue({
          values: firstInfra.values,
          key: DataPlaneSchemaNameValue,
          label: "first Postgres infra",
        }),
      ).not.toBe(
        readValue({
          values: secondInfra.values,
          key: DataPlaneSchemaNameValue,
          label: "second Postgres infra",
        }),
      );

      await Promise.all(
        logicalInfraStops.splice(0, logicalInfraStops.length).map(async (stop) => stop()),
      );

      const [third] = await requirement.provisioner.provision({
        environmentId: "test_env_postgres_lifecycle_c",
        requirements: [requirement],
      });
      if (third === undefined) {
        throw new Error("Expected Postgres provisioner to resolve a third logical resource.");
      }
      logicalInfraStops.push(third.stop);

      expect(
        readValue({
          values: third.values,
          key: HostDirectUrlValue,
          label: "third Postgres infra",
        }),
      ).toBe(
        readValue({
          values: firstInfra.values,
          key: HostDirectUrlValue,
          label: "first Postgres infra",
        }),
      );
    },
    TestTimeoutMs,
  );

  it(
    "reuses one physical Valkey lease while clearing logical key prefixes",
    async () => {
      const registry = createTestRegistry({
        sharedInfraKey: `valkey-lifecycle-${randomUUID()}`,
      });
      const requirement = readValkeyRequirement(registry);

      const [first, second] = await Promise.all([
        requirement.provisioner.provision({
          environmentId: "test_env_valkey_lifecycle_a",
          requirements: [requirement],
        }),
        requirement.provisioner.provision({
          environmentId: "test_env_valkey_lifecycle_b",
          requirements: [requirement],
        }),
      ]);
      const firstInfra = first[0];
      const secondInfra = second[0];
      if (firstInfra === undefined || secondInfra === undefined) {
        throw new Error("Expected Valkey provisioner to resolve both logical resources.");
      }
      logicalInfraStops.push(firstInfra.stop, secondInfra.stop);

      const firstUrl = readValue({
        values: firstInfra.values,
        key: HostUrlValue,
        label: "first Valkey infra",
      });
      const secondUrl = readValue({
        values: secondInfra.values,
        key: HostUrlValue,
        label: "second Valkey infra",
      });
      const firstPrefix = readValue({
        values: firstInfra.values,
        key: KeyPrefixValue,
        label: "first Valkey infra",
      });
      const secondPrefix = readValue({
        values: secondInfra.values,
        key: KeyPrefixValue,
        label: "second Valkey infra",
      });

      expect(secondUrl).toBe(firstUrl);
      expect(secondPrefix).not.toBe(firstPrefix);

      await setValkeyValue({
        url: firstUrl,
        key: `${firstPrefix}owned`,
        value: "first",
      });
      await setValkeyValue({
        url: secondUrl,
        key: `${secondPrefix}owned`,
        value: "second",
      });

      await firstInfra.stop();

      expect(
        await readValkeyValue({
          url: firstUrl,
          key: `${firstPrefix}owned`,
        }),
      ).toBeNull();
      expect(
        await readValkeyValue({
          url: secondUrl,
          key: `${secondPrefix}owned`,
        }),
      ).toBe("second");

      await secondInfra.stop();
      logicalInfraStops.splice(logicalInfraStops.indexOf(firstInfra.stop), 1);
      logicalInfraStops.splice(logicalInfraStops.indexOf(secondInfra.stop), 1);
    },
    TestTimeoutMs,
  );

  it(
    "keeps runner-owned shared Postgres alive after logical environments stop",
    async () => {
      const runId = `postgres-runner-owned-${randomUUID()}`;
      sharedInfraRunIds.push(runId);
      const previousRunId = process.env[MISTLE_TEST_RUN_ID_ENV];
      const previousPooling = process.env[MISTLE_TEST_POOLING_ENV];
      const previousOwnerPid = process.env[MISTLE_TEST_RUN_OWNER_PID_ENV];
      process.env[MISTLE_TEST_RUN_ID_ENV] = runId;
      process.env[MISTLE_TEST_POOLING_ENV] = "1";
      process.env[MISTLE_TEST_RUN_OWNER_PID_ENV] = String(process.pid);

      try {
        const firstRegistry = createTestRegistry();
        const secondRegistry = createTestRegistry();
        const firstRequirement = readPostgresRequirement(firstRegistry);
        const secondRequirement = readPostgresRequirement(secondRegistry);

        const [first] = await firstRequirement.provisioner.provision({
          environmentId: "test_env_runner_owned_a",
          requirements: [firstRequirement],
        });
        const [second] = await secondRequirement.provisioner.provision({
          environmentId: "test_env_runner_owned_b",
          requirements: [secondRequirement],
        });
        if (first === undefined || second === undefined) {
          throw new Error("Expected runner-owned Postgres provisions to resolve.");
        }

        const firstDirectUrl = readValue({
          values: first.values,
          key: HostDirectUrlValue,
          label: "first runner-owned Postgres infra",
        });
        const secondDirectUrl = readValue({
          values: second.values,
          key: HostDirectUrlValue,
          label: "second runner-owned Postgres infra",
        });
        expect(secondDirectUrl).toBe(firstDirectUrl);

        await first.stop();
        await second.stop();

        const thirdRegistry = createTestRegistry();
        const thirdRequirement = readPostgresRequirement(thirdRegistry);
        const [third] = await thirdRequirement.provisioner.provision({
          environmentId: "test_env_runner_owned_c",
          requirements: [thirdRequirement],
        });
        if (third === undefined) {
          throw new Error("Expected runner-owned Postgres to resolve after logical stops.");
        }

        expect(
          readValue({
            values: third.values,
            key: HostDirectUrlValue,
            label: "third runner-owned Postgres infra",
          }),
        ).toBe(firstDirectUrl);

        await third.stop();
        await stopSharedInfraForTestRun(runId);
        sharedInfraRunIds.splice(sharedInfraRunIds.indexOf(runId), 1);

        expect(await canConnectToPostgres(firstDirectUrl)).toBe(false);
      } finally {
        restoreEnvValue(MISTLE_TEST_RUN_ID_ENV, previousRunId);
        restoreEnvValue(MISTLE_TEST_POOLING_ENV, previousPooling);
        restoreEnvValue(MISTLE_TEST_RUN_OWNER_PID_ENV, previousOwnerPid);
      }
    },
    TestTimeoutMs,
  );

  it(
    "keeps runner-owned shared Valkey alive after logical environments stop",
    async () => {
      const runId = `valkey-runner-owned-${randomUUID()}`;
      sharedInfraRunIds.push(runId);
      const previousRunId = process.env[MISTLE_TEST_RUN_ID_ENV];
      const previousPooling = process.env[MISTLE_TEST_POOLING_ENV];
      const previousOwnerPid = process.env[MISTLE_TEST_RUN_OWNER_PID_ENV];
      process.env[MISTLE_TEST_RUN_ID_ENV] = runId;
      process.env[MISTLE_TEST_POOLING_ENV] = "1";
      process.env[MISTLE_TEST_RUN_OWNER_PID_ENV] = String(process.pid);

      try {
        const firstRegistry = createTestRegistry();
        const secondRegistry = createTestRegistry();
        const firstRequirement = readValkeyRequirement(firstRegistry);
        const secondRequirement = readValkeyRequirement(secondRegistry);

        const [first] = await firstRequirement.provisioner.provision({
          environmentId: "test_env_runner_owned_valkey_a",
          requirements: [firstRequirement],
        });
        const [second] = await secondRequirement.provisioner.provision({
          environmentId: "test_env_runner_owned_valkey_b",
          requirements: [secondRequirement],
        });
        if (first === undefined || second === undefined) {
          throw new Error("Expected runner-owned Valkey provisions to resolve.");
        }

        const firstUrl = readValue({
          values: first.values,
          key: HostUrlValue,
          label: "first runner-owned Valkey infra",
        });
        const secondUrl = readValue({
          values: second.values,
          key: HostUrlValue,
          label: "second runner-owned Valkey infra",
        });
        expect(secondUrl).toBe(firstUrl);

        await first.stop();
        await second.stop();

        const thirdRegistry = createTestRegistry();
        const thirdRequirement = readValkeyRequirement(thirdRegistry);
        const [third] = await thirdRequirement.provisioner.provision({
          environmentId: "test_env_runner_owned_valkey_c",
          requirements: [thirdRequirement],
        });
        if (third === undefined) {
          throw new Error("Expected runner-owned Valkey to resolve after logical stops.");
        }

        expect(
          readValue({
            values: third.values,
            key: HostUrlValue,
            label: "third runner-owned Valkey infra",
          }),
        ).toBe(firstUrl);

        await third.stop();
        await stopSharedInfraForTestRun(runId);
        sharedInfraRunIds.splice(sharedInfraRunIds.indexOf(runId), 1);

        expect(await canConnectToUrl(firstUrl)).toBe(false);
      } finally {
        restoreEnvValue(MISTLE_TEST_RUN_ID_ENV, previousRunId);
        restoreEnvValue(MISTLE_TEST_POOLING_ENV, previousPooling);
        restoreEnvValue(MISTLE_TEST_RUN_OWNER_PID_ENV, previousOwnerPid);
      }
    },
    TestTimeoutMs,
  );
});

function readPostgresRequirement(registry: ReturnType<typeof createTestRegistry>) {
  const requirement = registry["data-plane-api"].infra.find(
    (candidate) => candidate.id === PostgresInfraId,
  );
  if (requirement === undefined) {
    throw new Error("Expected data-plane-api to require Postgres.");
  }

  return requirement;
}

function readValkeyRequirement(registry: ReturnType<typeof createTestRegistry>) {
  const requirement = registry["data-plane-gateway"].infra.find(
    (candidate) => candidate.id === ValkeyInfraId,
  );
  if (requirement === undefined) {
    throw new Error("Expected data-plane-gateway to require Valkey.");
  }

  return requirement;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

async function canConnectToPostgres(connectionString: string): Promise<boolean> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 500,
  });

  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function setValkeyValue(input: { url: string; key: string; value: string }): Promise<void> {
  const client = createClient({
    url: input.url,
  });

  await client.connect();
  try {
    await client.set(input.key, input.value);
  } finally {
    await client.close();
  }
}

async function readValkeyValue(input: { url: string; key: string }): Promise<string | null> {
  const client = createClient({
    url: input.url,
  });

  await client.connect();
  try {
    return await client.get(input.key);
  } finally {
    await client.close();
  }
}

async function canConnectToUrl(url: string): Promise<boolean> {
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname;
  const port = Number(parsedUrl.port);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Expected ${url} to include a valid port.`);
  }

  return canConnectToTcp({
    host: hostname,
    port,
  });
}

function canConnectToTcp(input: { host: string; port: number }): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const settle = (value: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(500, () => settle(false));
    socket.once("error", () => settle(false));
    socket.connect(input.port, input.host, () => settle(true));
  });
}

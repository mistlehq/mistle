import { Pool } from "pg";
import postgres from "postgres";
import type { Sql } from "postgres";

import { registerProcessCleanupTask } from "../../cleanup/index.js";

type Lease<T> = {
  value: T;
  release: () => Promise<void>;
};

type SharedPool<T> = {
  value: T;
  leases: number;
  close: () => Promise<void>;
  unregisterCleanup: () => void;
};

const PostgresJsPools = new Map<string, SharedPool<Sql>>();
const PgPools = new Map<string, SharedPool<Pool>>();

export function leasePostgresJsPool(input: {
  key: string;
  url: string;
  max: number;
  applicationName: string;
}): Lease<Sql> {
  return leasePool({
    pools: PostgresJsPools,
    key: input.key,
    create: () =>
      postgres(withApplicationName(input.url, input.applicationName), {
        max: input.max,
        transform: {
          column: {
            from: postgres.toCamel,
          },
        },
      }),
    close: async (pool) => {
      await pool.end({ timeout: 1 });
    },
  });
}

export function leasePgPool(input: {
  key: string;
  connectionString: string;
  max: number;
  applicationName: string;
}): Lease<Pool> {
  return leasePool({
    pools: PgPools,
    key: input.key,
    create: () =>
      new Pool({
        application_name: input.applicationName,
        connectionString: input.connectionString,
        max: input.max,
      }),
    close: async (pool) => {
      await pool.end();
    },
  });
}

function leasePool<T>(input: {
  pools: Map<string, SharedPool<T>>;
  key: string;
  create: () => T;
  close: (value: T) => Promise<void>;
}): Lease<T> {
  const existing = input.pools.get(input.key);
  if (existing !== undefined) {
    existing.leases += 1;

    return {
      value: existing.value,
      release: async () => releasePool(input.pools, input.key),
    };
  }

  const value = input.create();
  const unregisterCleanup = registerProcessCleanupTask(async () => {
    input.pools.delete(input.key);
    await input.close(value);
  });

  input.pools.set(input.key, {
    value,
    leases: 1,
    close: async () => {
      await input.close(value);
    },
    unregisterCleanup,
  });

  return {
    value,
    release: async () => releasePool(input.pools, input.key),
  };
}

async function releasePool<T>(pools: Map<string, SharedPool<T>>, key: string): Promise<void> {
  const pool = pools.get(key);
  if (pool === undefined) {
    return;
  }

  pool.leases -= 1;
  if (pool.leases > 0) {
    return;
  }

  pools.delete(key);
  pool.unregisterCleanup();
  await pool.close();
}

function withApplicationName(url: string, applicationName: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("application_name", applicationName);
  return parsed.toString();
}

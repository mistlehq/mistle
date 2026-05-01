import { Pool, type PoolConfig } from "pg";
import { describe, expect, it } from "vitest";

import type {
  ResolvedTestInfra,
  TestEnvironment,
  TestServiceCollection,
} from "../environment/index.js";
import { createIntegrationEnvironment } from "./environment.js";
import type { ServiceId } from "./services/service-ids.js";

function createEnvironment(): TestEnvironment<ServiceId> {
  return {
    id: "env_database_pool",
    infra: new Map<string, ResolvedTestInfra>([
      [
        "postgres.control-plane",
        {
          id: "postgres.control-plane",
          kind: "postgres",
          values: new Map([
            ["host.directUrl", "postgresql://mistle:mistle@127.0.0.1:1/mistle"],
            ["schema.controlPlane", "env_database_pool_control_plane"],
          ]),
          stop: async () => {},
        },
      ],
      [
        "postgres.data-plane",
        {
          id: "postgres.data-plane",
          kind: "postgres",
          values: new Map([
            ["host.directUrl", "postgresql://mistle:mistle@127.0.0.1:1/mistle"],
            ["schema.dataPlane", "env_database_pool_data_plane"],
          ]),
          stop: async () => {},
        },
      ],
    ]),
    services: createServiceCollection(),
    stop: async () => {},
  };
}

function createServiceCollection(): TestServiceCollection<ServiceId> {
  return {
    get: (serviceId) => {
      return {
        id: serviceId,
        mode: "runtime",
        endpoints: {
          http: {
            hostBaseUrl: `http://127.0.0.1/${serviceId}`,
          },
        },
        start: async () => {},
        restart: async () => {},
        stop: async () => {},
      };
    },
    keys: () => [],
    values: () => [],
  };
}

describe("createIntegrationEnvironment", () => {
  it("reuses managed database handles and controls pool configuration", async () => {
    const pools: Pool[] = [];
    const env = createIntegrationEnvironment({
      environment: createEnvironment(),
      poolFactory: (config: PoolConfig) => {
        const pool = new Pool(config);
        pools.push(pool);
        return pool;
      },
    });

    expect(env.controlPlaneDb).toBe(env.controlPlaneDb);
    expect(env.dataPlaneDb).toBe(env.dataPlaneDb);
    expect(pools).toHaveLength(2);
    expect(pools.map((pool) => pool.options.max)).toEqual([4, 4]);

    await env.stop();

    expect(pools.map((pool) => pool.ended)).toEqual([true, true]);
  });

  it("does not create database pools when tests never access database handles", async () => {
    const pools: Pool[] = [];
    const env = createIntegrationEnvironment({
      environment: createEnvironment(),
      poolFactory: (config: PoolConfig) => {
        const pool = new Pool(config);
        pools.push(pool);
        return pool;
      },
    });

    await env.stop();
    await env.stop();

    expect(pools).toEqual([]);
  });
});

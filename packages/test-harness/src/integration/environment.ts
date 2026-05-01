import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import { Pool, type PoolConfig } from "pg";

import type { TestEnvironment } from "../environment/index.js";
import { createMailpitInbox, type MailpitInbox } from "../services/mailpit/index.js";
import { ServiceIds, type ServiceId } from "./services/service-ids.js";
import { httpService, type IntegrationHttpService } from "./services/shared.js";

const DefaultDatabasePoolMax = 4;
const PostgresValues = {
  HOST_DIRECT_URL: "host.directUrl",
  CONTROL_PLANE_SCHEMA_NAME: "schema.controlPlane",
  DATA_PLANE_SCHEMA_NAME: "schema.dataPlane",
};

type IntegrationDatabasePoolFactory = (config: PoolConfig) => Pool;

export type IntegrationTestEnvironment = {
  id: string;
  controlPlaneDb: ControlPlaneDatabase;
  controlPlaneApi: IntegrationHttpService;
  dataPlaneDb: DataPlaneDatabase;
  dataPlaneApi: IntegrationHttpService;
  dataPlaneGateway: IntegrationHttpService;
  mailpit: MailpitInbox;
};

export type ManagedIntegrationTestEnvironment = IntegrationTestEnvironment & {
  stop: () => Promise<void>;
};

export function createIntegrationEnvironment(input: {
  environment: TestEnvironment<ServiceId>;
  poolFactory?: IntegrationDatabasePoolFactory;
}): ManagedIntegrationTestEnvironment {
  const poolFactory = input.poolFactory ?? ((config) => new Pool(config));
  const pools: Pool[] = [];
  let stopped = false;
  let controlPlaneDb: ControlPlaneDatabase | undefined;
  let dataPlaneDb: DataPlaneDatabase | undefined;

  return {
    id: input.environment.id,
    get controlPlaneDb() {
      controlPlaneDb ??= createControlPlaneDatabase(
        createPool({
          connectionString: readPostgresDirectUrl(input.environment),
          poolFactory,
          pools,
        }),
        {
          schemaName: readControlPlaneSchemaName(input.environment),
        },
      );

      return controlPlaneDb;
    },
    get controlPlaneApi() {
      return httpService(input.environment.services.get(ServiceIds.CONTROL_PLANE_API));
    },
    get dataPlaneDb() {
      dataPlaneDb ??= createDataPlaneDatabase(
        createPool({
          connectionString: readPostgresDirectUrl(input.environment),
          poolFactory,
          pools,
        }),
        {
          schemaName: readDataPlaneSchemaName(input.environment),
        },
      );

      return dataPlaneDb;
    },
    get dataPlaneApi() {
      return httpService(input.environment.services.get(ServiceIds.DATA_PLANE_API));
    },
    get dataPlaneGateway() {
      return httpService(input.environment.services.get(ServiceIds.DATA_PLANE_GATEWAY));
    },
    get mailpit() {
      const mailpit = input.environment.infra.get("mailpit");
      const httpBaseUrl = mailpit?.values.get("http.baseUrl");
      if (httpBaseUrl === undefined) {
        throw new Error("Expected integration environment to include Mailpit infra.");
      }

      return createMailpitInbox({
        httpBaseUrl,
      });
    },
    stop: async () => {
      if (stopped) {
        return;
      }

      stopped = true;
      await Promise.all(pools.map((pool) => pool.end()));
    },
  };
}

function createPool(input: {
  connectionString: string;
  poolFactory: IntegrationDatabasePoolFactory;
  pools: Pool[];
}): Pool {
  const pool = input.poolFactory({
    connectionString: input.connectionString,
    max: DefaultDatabasePoolMax,
  });

  pool.on("error", () => {});
  input.pools.push(pool);

  return pool;
}

function readPostgresDirectUrl(environment: TestEnvironment<ServiceId>): string {
  const postgres = environment.infra.get("postgres");
  const directUrl = postgres?.values.get(PostgresValues.HOST_DIRECT_URL);
  if (directUrl === undefined) {
    throw new Error("Expected integration environment to include Postgres infra.");
  }

  return directUrl;
}

function readDataPlaneSchemaName(environment: TestEnvironment<ServiceId>): string {
  const postgres = environment.infra.get("postgres");
  const schemaName = postgres?.values.get(PostgresValues.DATA_PLANE_SCHEMA_NAME);
  if (schemaName === undefined) {
    throw new Error("Expected integration environment to include data-plane schema name.");
  }

  return schemaName;
}

function readControlPlaneSchemaName(environment: TestEnvironment<ServiceId>): string {
  const postgres = environment.infra.get("postgres");
  const schemaName = postgres?.values.get(PostgresValues.CONTROL_PLANE_SCHEMA_NAME);
  if (schemaName === undefined) {
    throw new Error("Expected integration environment to include control-plane schema name.");
  }

  return schemaName;
}

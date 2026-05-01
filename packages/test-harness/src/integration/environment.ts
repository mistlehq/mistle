import {
  createControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import {
  createDataPlaneDatabase,
  getDataPlaneDatabaseSchema,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { Pool, type PoolConfig } from "pg";

import type { TestEnvironment, TestServiceHandle } from "../environment/index.js";
import { createMailpitInbox, type MailpitInbox } from "../services/mailpit/index.js";
import { createIntegrationAuth, type IntegrationAuth } from "./auth.js";
import { ServiceIds, type ServiceId } from "./services/service-ids.js";
import { httpService, type IntegrationHttpService } from "./services/shared.js";

const DefaultDatabasePoolMax = 4;
const PostgresValues = {
  HOST_DIRECT_URL: "host.directUrl",
  CONTROL_PLANE_SCHEMA_NAME: "schema.controlPlane",
  DATA_PLANE_SCHEMA_NAME: "schema.dataPlane",
};

const PostgresInfraIds = {
  CONTROL_PLANE: "postgres.control-plane",
  DATA_PLANE: "postgres.data-plane",
};

type IntegrationDatabasePoolFactory = (config: PoolConfig) => Pool;

export type IntegrationTestEnvironment = {
  id: string;
  auth: IntegrationAuth;
  controlPlaneDb: ControlPlaneDatabase;
  controlPlaneTables: ReturnType<typeof getControlPlaneDatabaseSchema>;
  controlPlaneApi: IntegrationHttpService;
  controlPlaneWorker: IntegrationProcessService;
  dataPlaneDb: DataPlaneDatabase;
  dataPlaneTables: ReturnType<typeof getDataPlaneDatabaseSchema>;
  dataPlaneApi: IntegrationHttpService;
  dataPlaneGateway: IntegrationHttpService;
  dataPlaneWorker: IntegrationProcessService;
  mailpit: MailpitInbox;
  tokenizerProxy: IntegrationHttpService;
};

export type ManagedIntegrationTestEnvironment = IntegrationTestEnvironment & {
  stop: () => Promise<void>;
};

export type IntegrationProcessService = TestServiceHandle & {
  pid: number;
};

export function createIntegrationEnvironment(input: {
  environment: TestEnvironment<ServiceId>;
  poolFactory?: IntegrationDatabasePoolFactory;
}): ManagedIntegrationTestEnvironment {
  const poolFactory = input.poolFactory ?? ((config) => new Pool(config));
  const pools: Pool[] = [];
  let stopped = false;
  let auth: IntegrationAuth | undefined;
  let controlPlaneDb: ControlPlaneDatabase | undefined;
  let dataPlaneDb: DataPlaneDatabase | undefined;

  const integrationEnvironment: ManagedIntegrationTestEnvironment = {
    id: input.environment.id,
    get auth() {
      auth ??= createIntegrationAuth(integrationEnvironment);

      return auth;
    },
    get controlPlaneDb() {
      controlPlaneDb ??= createControlPlaneDatabase(
        createPool({
          connectionString: readPostgresDirectUrl({
            environment: input.environment,
            infraId: PostgresInfraIds.CONTROL_PLANE,
          }),
          poolFactory,
          pools,
        }),
        {
          schemaName: readControlPlaneSchemaName(input.environment),
        },
      );

      return controlPlaneDb;
    },
    get controlPlaneTables() {
      return getControlPlaneDatabaseSchema(this.controlPlaneDb);
    },
    get controlPlaneApi() {
      return httpService(input.environment.services.get(ServiceIds.CONTROL_PLANE_API));
    },
    get controlPlaneWorker() {
      return processService(input.environment.services.get(ServiceIds.CONTROL_PLANE_WORKER));
    },
    get dataPlaneDb() {
      dataPlaneDb ??= createDataPlaneDatabase(
        createPool({
          connectionString: readPostgresDirectUrl({
            environment: input.environment,
            infraId: PostgresInfraIds.DATA_PLANE,
          }),
          poolFactory,
          pools,
        }),
        {
          schemaName: readDataPlaneSchemaName(input.environment),
        },
      );

      return dataPlaneDb;
    },
    get dataPlaneTables() {
      return getDataPlaneDatabaseSchema(this.dataPlaneDb);
    },
    get dataPlaneApi() {
      return httpService(input.environment.services.get(ServiceIds.DATA_PLANE_API));
    },
    get dataPlaneGateway() {
      return httpService(input.environment.services.get(ServiceIds.DATA_PLANE_GATEWAY));
    },
    get dataPlaneWorker() {
      return processService(input.environment.services.get(ServiceIds.DATA_PLANE_WORKER));
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
    get tokenizerProxy() {
      return httpService(input.environment.services.get(ServiceIds.TOKENIZER_PROXY));
    },
    stop: async () => {
      if (stopped) {
        return;
      }

      stopped = true;
      await Promise.all(pools.map((pool) => pool.end()));
    },
  };

  return integrationEnvironment;
}

function processService(service: TestServiceHandle): IntegrationProcessService {
  const pid = service.pid;
  if (pid === undefined) {
    throw new Error(`Expected test service '${service.id}' to expose a process id.`);
  }

  return {
    ...service,
    pid,
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

  input.pools.push(pool);

  return pool;
}

function readPostgresDirectUrl(input: {
  environment: TestEnvironment<ServiceId>;
  infraId: string;
}): string {
  const postgres = input.environment.infra.get(input.infraId);
  const directUrl = postgres?.values.get(PostgresValues.HOST_DIRECT_URL);
  if (directUrl === undefined) {
    throw new Error(
      `Expected integration environment to include Postgres infra '${input.infraId}'.`,
    );
  }

  return directUrl;
}

function readDataPlaneSchemaName(environment: TestEnvironment<ServiceId>): string {
  const postgres = environment.infra.get(PostgresInfraIds.DATA_PLANE);
  const schemaName = postgres?.values.get(PostgresValues.DATA_PLANE_SCHEMA_NAME);
  if (schemaName === undefined) {
    throw new Error("Expected integration environment to include data-plane schema name.");
  }

  return schemaName;
}

function readControlPlaneSchemaName(environment: TestEnvironment<ServiceId>): string {
  const postgres = environment.infra.get(PostgresInfraIds.CONTROL_PLANE);
  const schemaName = postgres?.values.get(PostgresValues.CONTROL_PLANE_SCHEMA_NAME);
  if (schemaName === undefined) {
    throw new Error("Expected integration environment to include control-plane schema name.");
  }

  return schemaName;
}

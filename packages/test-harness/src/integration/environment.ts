import {
  DeleteObjectCommand,
  type DeleteObjectCommandOutput,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  type PutObjectCommandInput,
  type PutObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
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
import { injectActiveTraceContextIntoWorkflowRunContext } from "@mistle/telemetry";
import { OpenWorkflow } from "openworkflow";
import { BackendPostgres } from "openworkflow/postgres";
import { Pool, type PoolConfig } from "pg";

import {
  createControlPlaneWorkflowNamespaceId,
  createDataPlaneWorkflowNamespaceId,
} from "../environment/test-isolation.js";
import type { TestEnvironment, TestServiceHandle } from "../environment/types.js";
import { createMailpitInbox, type MailpitInbox } from "../services/mailpit/index.js";
import { readOtlpTestCollector, type OtlpTestCollector } from "../services/otlp-test-collector.js";
import { createIntegrationAuth, type IntegrationAuth } from "./auth.js";
import { ServiceIds } from "./services/service-ids.js";
import { httpService, type IntegrationHttpService } from "./services/shared.js";

const DefaultDatabasePoolMax = 4;
const ControlPlaneOpenWorkflowSchema = "control_plane_openworkflow";
const DataPlaneOpenWorkflowSchema = "data_plane_openworkflow";
const PostgresValues = {
  HOST_DIRECT_URL: "host.directUrl",
  HOST_POOLED_URL: "host.pooledUrl",
  CONTROL_PLANE_SCHEMA_NAME: "schema.controlPlane",
  DATA_PLANE_SCHEMA_NAME: "schema.dataPlane",
};

const PostgresInfraIds = {
  CONTROL_PLANE: "postgres.control-plane",
  DATA_PLANE: "postgres.data-plane",
};

const SeaweedfsInfraId = "seaweedfs";
const OtlpInfraId = "otlp";
const OtlpValues = {
  COLLECTOR_ID: "collectorId",
};
const ValkeyInfraId = "valkey";
const NatsInfraId = "nats";
const NatsValues = {
  URL: "url",
};
const ValkeyValues = {
  HOST_URL: "host.url",
  KEY_PREFIX: "keyPrefix",
};
const SeaweedfsValues = {
  BUCKET_NAME: "bucketName",
  HOST_ENDPOINT: "host.endpoint",
  REGION: "region",
  ACCESS_KEY_ID: "accessKeyId",
  SECRET_ACCESS_KEY: "secretAccessKey",
};

type IntegrationDatabasePoolFactory = (config: PoolConfig) => Pool;

export type IntegrationObjectStore = {
  putObject: (input: {
    objectKey: string;
    Body: NonNullable<PutObjectCommandInput["Body"]>;
    ContentType?: PutObjectCommandInput["ContentType"];
    CacheControl?: PutObjectCommandInput["CacheControl"];
  }) => Promise<PutObjectCommandOutput>;
  headObject: (objectKey: string) => Promise<HeadObjectCommandOutput>;
  readObject: (objectKey: string) => Promise<GetObjectCommandOutput>;
  deleteObject: (objectKey: string) => Promise<DeleteObjectCommandOutput>;
  destroy: () => void;
};

export type IntegrationRuntimeStateStore = {
  valkeyUrl: string;
  keyPrefix: string;
};

export type IntegrationNats = {
  url: string;
};

export type IntegrationDatabaseInfo = {
  directUrl: string;
  pooledUrl: string;
  schemaName: string;
};

export type IntegrationTestEnvironment = {
  id: string;
  service: (serviceId: string) => TestServiceHandle;
  httpService: (serviceId: string) => IntegrationHttpService;
  auth: IntegrationAuth;
  controlPlaneDatabase: IntegrationDatabaseInfo;
  controlPlaneDb: ControlPlaneDatabase;
  controlPlaneTables: ReturnType<typeof getControlPlaneDatabaseSchema>;
  controlPlaneWorkflow: IntegrationWorkflowClient;
  controlPlaneApi: IntegrationHttpService;
  controlPlaneWorker: IntegrationProcessService;
  dataPlaneDb: DataPlaneDatabase;
  dataPlaneTables: ReturnType<typeof getDataPlaneDatabaseSchema>;
  dataPlaneWorkflow: IntegrationWorkflowClient;
  dataPlaneApi: IntegrationHttpService;
  dataPlaneGateway: IntegrationHttpService;
  nats: IntegrationNats;
  dataPlaneGatewayRuntimeState: IntegrationRuntimeStateStore;
  dataPlaneWorker: IntegrationProcessService;
  mailpit: MailpitInbox;
  objectStore: IntegrationObjectStore;
  otlpCollector: OtlpTestCollector;
};

export type ManagedIntegrationTestEnvironment = IntegrationTestEnvironment & {
  stop: () => Promise<void>;
};

export type IntegrationProcessService = TestServiceHandle & {
  pid: number;
};

export function createIntegrationEnvironment(input: {
  environment: TestEnvironment<string>;
  poolFactory?: IntegrationDatabasePoolFactory;
}): ManagedIntegrationTestEnvironment {
  const poolFactory = input.poolFactory ?? ((config) => new Pool(config));
  const pools: Pool[] = [];
  let stopped = false;
  let auth: IntegrationAuth | undefined;
  let controlPlaneDb: ControlPlaneDatabase | undefined;
  let controlPlaneWorkflowResources: IntegrationWorkflowResources | undefined;
  let dataPlaneDb: DataPlaneDatabase | undefined;
  let dataPlaneWorkflowResources: IntegrationWorkflowResources | undefined;
  let objectStore: IntegrationObjectStore | undefined;

  const integrationEnvironment: ManagedIntegrationTestEnvironment = {
    id: input.environment.id,
    service: (serviceId) => input.environment.services.get(serviceId),
    httpService: (serviceId) => httpService(input.environment.services.get(serviceId)),
    get auth() {
      auth ??= createIntegrationAuth(integrationEnvironment);

      return auth;
    },
    get controlPlaneDatabase() {
      return {
        directUrl: readPostgresDirectUrl({
          environment: input.environment,
          infraId: PostgresInfraIds.CONTROL_PLANE,
        }),
        pooledUrl: readPostgresPooledUrl({
          environment: input.environment,
          infraId: PostgresInfraIds.CONTROL_PLANE,
        }),
        schemaName: readControlPlaneSchemaName(input.environment),
      };
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
    get controlPlaneWorkflow() {
      controlPlaneWorkflowResources ??= createControlPlaneWorkflowResources(input.environment);

      return controlPlaneWorkflowResources.client;
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
    get dataPlaneWorkflow() {
      dataPlaneWorkflowResources ??= createDataPlaneWorkflowResources(input.environment);

      return dataPlaneWorkflowResources.client;
    },
    get dataPlaneApi() {
      return httpService(input.environment.services.get(ServiceIds.DATA_PLANE_API));
    },
    get dataPlaneGateway() {
      return httpService(input.environment.services.get(ServiceIds.DATA_PLANE_GATEWAY));
    },
    get nats() {
      const nats = input.environment.infra.get(NatsInfraId);
      if (nats === undefined) {
        throw new Error("Expected integration environment to include NATS infra.");
      }

      return {
        url: readInfraValue(nats, NatsValues.URL),
      };
    },
    get dataPlaneGatewayRuntimeState() {
      const valkey = input.environment.infra.get(ValkeyInfraId);
      if (valkey === undefined) {
        throw new Error("Expected integration environment to include Valkey infra.");
      }

      return {
        valkeyUrl: readInfraValue(valkey, ValkeyValues.HOST_URL),
        keyPrefix: readInfraValue(valkey, ValkeyValues.KEY_PREFIX),
      };
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
    get objectStore() {
      objectStore ??= createObjectStore(input.environment);

      return objectStore;
    },
    get otlpCollector() {
      const otlp = input.environment.infra.get(OtlpInfraId);
      const collectorId = otlp?.values.get(OtlpValues.COLLECTOR_ID);
      if (collectorId === undefined) {
        throw new Error("Expected integration environment to include OTLP collector infra.");
      }

      return readOtlpTestCollector(collectorId);
    },
    stop: async () => {
      if (stopped) {
        return;
      }

      stopped = true;
      const controlPlaneWorkflowBackend = await controlPlaneWorkflowResources?.backend;
      const workflowBackend = await dataPlaneWorkflowResources?.backend;
      await Promise.all([
        ...pools.map((pool) => pool.end()),
        controlPlaneWorkflowBackend?.stop() ?? Promise.resolve(),
        workflowBackend?.stop() ?? Promise.resolve(),
      ]);
      objectStore?.destroy();
    },
  };

  return integrationEnvironment;
}

function createObjectStore(environment: TestEnvironment<string>): IntegrationObjectStore {
  const seaweedfs = environment.infra.get(SeaweedfsInfraId);
  if (seaweedfs === undefined) {
    throw new Error("Expected integration environment to include SeaweedFS infra.");
  }

  const bucketName = readInfraValue(seaweedfs, SeaweedfsValues.BUCKET_NAME);
  const client = new S3Client({
    endpoint: readInfraValue(seaweedfs, SeaweedfsValues.HOST_ENDPOINT),
    forcePathStyle: true,
    region: readInfraValue(seaweedfs, SeaweedfsValues.REGION),
    credentials: {
      accessKeyId: readInfraValue(seaweedfs, SeaweedfsValues.ACCESS_KEY_ID),
      secretAccessKey: readInfraValue(seaweedfs, SeaweedfsValues.SECRET_ACCESS_KEY),
    },
  });

  return {
    putObject: async (input) =>
      client.send(
        new PutObjectCommand({
          Body: input.Body,
          Bucket: bucketName,
          CacheControl: input.CacheControl,
          ContentType: input.ContentType,
          Key: input.objectKey,
        }),
      ),
    headObject: async (objectKey) =>
      client.send(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
        }),
      ),
    readObject: async (objectKey) =>
      client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
        }),
      ),
    deleteObject: async (objectKey) =>
      client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
        }),
      ),
    destroy: () => client.destroy(),
  };
}

type IntegrationWorkflowResources = {
  backend: Promise<BackendPostgres>;
  client: IntegrationWorkflowClient;
};

export type IntegrationWorkflowClient = Pick<OpenWorkflow, "runWorkflow" | "sendSignal">;

function createControlPlaneWorkflowResources(
  environment: TestEnvironment<string>,
): IntegrationWorkflowResources {
  const backend = BackendPostgres.connect(
    readPostgresDirectUrl({
      environment,
      infraId: PostgresInfraIds.CONTROL_PLANE,
    }),
    {
      namespaceId: createControlPlaneWorkflowNamespaceId(environment.id),
      runMigrations: false,
      schema: ControlPlaneOpenWorkflowSchema,
    },
  );

  return createIntegrationWorkflowResources(backend);
}

function createDataPlaneWorkflowResources(
  environment: TestEnvironment<string>,
): IntegrationWorkflowResources {
  const backend = BackendPostgres.connect(
    readPostgresDirectUrl({
      environment,
      infraId: PostgresInfraIds.DATA_PLANE,
    }),
    {
      namespaceId: createDataPlaneWorkflowNamespaceId(environment.id),
      runMigrations: false,
      schema: DataPlaneOpenWorkflowSchema,
    },
  );

  return createIntegrationWorkflowResources(backend);
}

function createIntegrationWorkflowResources(
  backend: Promise<BackendPostgres>,
): IntegrationWorkflowResources {
  return {
    backend,
    client: {
      runWorkflow: async (spec, workflowInput, options) => {
        const resolvedBackend = await backend;
        const openWorkflow = new OpenWorkflow({
          backend: createTracingWorkflowBackend(resolvedBackend),
        });

        return openWorkflow.runWorkflow(spec, workflowInput, options);
      },
      sendSignal: async (options) => {
        const resolvedBackend = await backend;
        const openWorkflow = new OpenWorkflow({
          backend: createTracingWorkflowBackend(resolvedBackend),
        });

        return openWorkflow.sendSignal(options);
      },
    },
  };
}

function createTracingWorkflowBackend(backend: BackendPostgres): BackendPostgres {
  return new Proxy(backend, {
    get(target, property, receiver) {
      if (property === "createWorkflowRun") {
        return async (...args: Parameters<BackendPostgres["createWorkflowRun"]>) => {
          const [params] = args;

          return target.createWorkflowRun({
            ...params,
            context: injectActiveTraceContextIntoWorkflowRunContext(params.context),
          });
        };
      }

      const value = Reflect.get(target, property, receiver);
      if (typeof value === "function") {
        return value.bind(target);
      }

      return value;
    },
  });
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
  environment: TestEnvironment<string>;
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

function readPostgresPooledUrl(input: {
  environment: TestEnvironment<string>;
  infraId: string;
}): string {
  const postgres = input.environment.infra.get(input.infraId);
  const pooledUrl = postgres?.values.get(PostgresValues.HOST_POOLED_URL);
  if (pooledUrl === undefined) {
    throw new Error(
      `Expected integration environment to include Postgres infra '${input.infraId}'.`,
    );
  }

  return pooledUrl;
}

function readDataPlaneSchemaName(environment: TestEnvironment<string>): string {
  const postgres = environment.infra.get(PostgresInfraIds.DATA_PLANE);
  const schemaName = postgres?.values.get(PostgresValues.DATA_PLANE_SCHEMA_NAME);
  if (schemaName === undefined) {
    throw new Error("Expected integration environment to include data-plane schema name.");
  }

  return schemaName;
}

function readControlPlaneSchemaName(environment: TestEnvironment<string>): string {
  const postgres = environment.infra.get(PostgresInfraIds.CONTROL_PLANE);
  const schemaName = postgres?.values.get(PostgresValues.CONTROL_PLANE_SCHEMA_NAME);
  if (schemaName === undefined) {
    throw new Error("Expected integration environment to include control-plane schema name.");
  }

  return schemaName;
}

function readInfraValue(
  infra: { id: string; values: ReadonlyMap<string, string> },
  key: string,
): string {
  const value = infra.values.get(key);
  if (value === undefined) {
    throw new Error(`Expected integration infra '${infra.id}' to expose '${key}'.`);
  }

  return value;
}

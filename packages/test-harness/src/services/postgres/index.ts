import { systemClock, systemSleeper } from "@mistle/time";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
} from "testcontainers";

const POSTGRES_IMAGE = "postgres:18-alpine";
const PGBOUNCER_IMAGE = "edoburu/pgbouncer:v1.25.1-p0";
const POSTGRES_INTERNAL_PORT = 5432;
const PGBOUNCER_PORT = 5432;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const READINESS_POLL_INTERVAL_MS = 100;

export type StartPostgresWithPgBouncerInput = {
  databaseName?: string;
  username?: string;
  password?: string;
  startupTimeoutMs?: number;
  poolMode?: "session" | "transaction" | "statement";
  defaultPoolSize?: number;
  maxClientConnections?: number;
};

export type PostgresWithPgBouncerService = {
  directUrl: string;
  pooledUrl: string;
  postgres: {
    host: string;
    port: number;
    databaseName: string;
    username: string;
    password: string;
  };
  pgbouncer: {
    host: string;
    port: number;
    poolMode: "session" | "transaction" | "statement";
    defaultPoolSize: number;
    maxClientConnections: number;
  };
  stop: () => Promise<void>;
};

type PostgresRuntimeConfig = {
  databaseName: string;
  username: string;
  password: string;
  startupTimeoutMs: number;
  poolMode: "session" | "transaction" | "statement";
  defaultPoolSize: number;
  maxClientConnections: number;
};

function resolveConfig(input: StartPostgresWithPgBouncerInput): PostgresRuntimeConfig {
  return {
    databaseName: input.databaseName ?? "mistle",
    username: input.username ?? "mistle",
    password: input.password ?? "mistle",
    startupTimeoutMs: input.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    poolMode: input.poolMode ?? "transaction",
    defaultPoolSize: input.defaultPoolSize ?? 20,
    maxClientConnections: input.maxClientConnections ?? 100,
  };
}

function buildConnectionString(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
}): string {
  return `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.host}:${input.port}/${input.databaseName}`;
}

async function waitForSqlCommand(input: {
  container: StartedTestContainer;
  connectionString: string;
  commandDescription: string;
  timeoutMs: number;
}): Promise<void> {
  const deadline = systemClock.nowMs() + input.timeoutMs;

  while (systemClock.nowMs() < deadline) {
    const result = await input.container.exec([
      "psql",
      input.connectionString,
      "-tA",
      "-c",
      "SELECT 1",
    ]);

    if (result.exitCode === 0) {
      return;
    }

    await systemSleeper.sleep(READINESS_POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for ${input.commandDescription} to accept SQL connections within ${input.timeoutMs}ms.`,
  );
}

type StackRuntimeResources = {
  pgbouncerContainer: StartedTestContainer | undefined;
  postgresContainer: StartedPostgreSqlContainer | undefined;
  network: StartedNetwork | undefined;
};

async function stopInReverseOrder(input: StackRuntimeResources): Promise<void> {
  if (input.pgbouncerContainer !== undefined) {
    await input.pgbouncerContainer.stop();
  }
  if (input.postgresContainer !== undefined) {
    await input.postgresContainer.stop();
  }
  if (input.network !== undefined) {
    await input.network.stop();
  }
}

export async function startPostgresWithPgBouncer(
  input: StartPostgresWithPgBouncerInput = {},
): Promise<PostgresWithPgBouncerService> {
  let network: StartedNetwork | undefined;
  let postgresContainer: StartedPostgreSqlContainer | undefined;
  let pgbouncerContainer: StartedTestContainer | undefined;
  let stopped = false;

  const config = resolveConfig(input);

  try {
    network = await new Network().start();

    postgresContainer = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase(config.databaseName)
      .withUsername(config.username)
      .withPassword(config.password)
      .withNetwork(network)
      .withNetworkAliases("postgres")
      .start();

    pgbouncerContainer = await new GenericContainer(PGBOUNCER_IMAGE)
      .withNetwork(network)
      .withExposedPorts(PGBOUNCER_PORT)
      .withEnvironment({
        DB_HOST: "postgres",
        DB_PORT: String(POSTGRES_INTERNAL_PORT),
        DB_NAME: config.databaseName,
        DB_USER: config.username,
        DB_PASSWORD: config.password,
        AUTH_TYPE: "plain",
        POOL_MODE: config.poolMode,
        DEFAULT_POOL_SIZE: String(config.defaultPoolSize),
        MAX_CLIENT_CONN: String(config.maxClientConnections),
      })
      .start();

    const postgresHost = postgresContainer.getHost();
    const postgresPort = postgresContainer.getPort();
    const pgbouncerHost = pgbouncerContainer.getHost();
    const pgbouncerPort = pgbouncerContainer.getMappedPort(PGBOUNCER_PORT);

    const directUrl = buildConnectionString({
      username: config.username,
      password: config.password,
      host: postgresHost,
      port: postgresPort,
      databaseName: config.databaseName,
    });

    const pooledUrl = buildConnectionString({
      username: config.username,
      password: config.password,
      host: pgbouncerHost,
      port: pgbouncerPort,
      databaseName: config.databaseName,
    });

    const postgresInternalUrl = buildConnectionString({
      username: config.username,
      password: config.password,
      host: "127.0.0.1",
      port: POSTGRES_INTERNAL_PORT,
      databaseName: config.databaseName,
    });
    const pgbouncerInternalUrl = buildConnectionString({
      username: config.username,
      password: config.password,
      host: "127.0.0.1",
      port: PGBOUNCER_PORT,
      databaseName: config.databaseName,
    });

    await waitForSqlCommand({
      container: postgresContainer,
      connectionString: postgresInternalUrl,
      commandDescription: "Postgres (direct)",
      timeoutMs: config.startupTimeoutMs,
    });
    await waitForSqlCommand({
      container: pgbouncerContainer,
      connectionString: pgbouncerInternalUrl,
      commandDescription: "PgBouncer (pooled)",
      timeoutMs: config.startupTimeoutMs,
    });

    return {
      directUrl,
      pooledUrl,
      postgres: {
        host: postgresHost,
        port: postgresPort,
        databaseName: config.databaseName,
        username: config.username,
        password: config.password,
      },
      pgbouncer: {
        host: pgbouncerHost,
        port: pgbouncerPort,
        poolMode: config.poolMode,
        defaultPoolSize: config.defaultPoolSize,
        maxClientConnections: config.maxClientConnections,
      },
      stop: async () => {
        if (stopped) {
          throw new Error("Postgres + PgBouncer stack was already stopped.");
        }

        stopped = true;
        await stopInReverseOrder({
          pgbouncerContainer,
          postgresContainer,
          network,
        });
        pgbouncerContainer = undefined;
        postgresContainer = undefined;
        network = undefined;
      },
    };
  } catch (error) {
    await stopInReverseOrder({
      pgbouncerContainer,
      postgresContainer,
      network,
    });
    throw error;
  }
}

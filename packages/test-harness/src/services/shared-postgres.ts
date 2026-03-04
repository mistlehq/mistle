import type {
  PostgresWithPgBouncerService,
  StartPostgresWithPgBouncerInput,
} from "./postgres/index.js";
import { acquireSharedInfraCoordinatorLease } from "./shared-infra-coordinator.js";

export type SharedPostgresInfra = {
  postgres: PostgresWithPgBouncerService;
  containerHostGateway: string;
};

export type AcquireSharedPostgresInfraInput = {
  key: string;
  postgres: Omit<
    StartPostgresWithPgBouncerInput,
    | "network"
    | "postgresNetworkAlias"
    | "pgbouncerNetworkAlias"
    | "manageProcessCleanup"
    | "containerLabels"
  >;
};

export type SharedPostgresLease = {
  infra: SharedPostgresInfra;
  release: () => Promise<void>;
};

export async function acquireSharedPostgresInfra(
  input: AcquireSharedPostgresInfraInput,
): Promise<SharedPostgresLease> {
  const coordinatorLease = await acquireSharedInfraCoordinatorLease({
    key: input.key,
    postgres: input.postgres,
    mailpit: false,
  });

  const postgres = coordinatorLease.infra.postgres;
  if (postgres === undefined) {
    await coordinatorLease.release();
    throw new Error(`Shared infra key ${input.key} did not provide postgres service.`);
  }

  return {
    infra: {
      postgres,
      containerHostGateway: coordinatorLease.infra.containerHostGateway,
    },
    release: coordinatorLease.release,
  };
}

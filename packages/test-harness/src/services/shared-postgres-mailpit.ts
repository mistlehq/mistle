import type { MailpitService } from "./mailpit/index.js";
import type {
  PostgresWithPgBouncerService,
  StartPostgresWithPgBouncerInput,
} from "./postgres/index.js";
import {
  acquireSharedInfraCoordinatorLease,
  DEFAULT_SHARED_INTEGRATION_INFRA_KEY,
} from "./shared-infra-coordinator.js";

export { DEFAULT_SHARED_INTEGRATION_INFRA_KEY };

export type SharedPostgresMailpitInfra = {
  postgres: PostgresWithPgBouncerService;
  mailpit: MailpitService;
  containerHostGateway: string;
};

export type AcquireSharedPostgresMailpitInfraInput = {
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

export type SharedPostgresMailpitLease = {
  infra: SharedPostgresMailpitInfra;
  release: () => Promise<void>;
};

export async function acquireSharedPostgresMailpitInfra(
  input: AcquireSharedPostgresMailpitInfraInput,
): Promise<SharedPostgresMailpitLease> {
  const coordinatorLease = await acquireSharedInfraCoordinatorLease({
    key: input.key,
    postgres: input.postgres,
    mailpit: true,
  });

  const postgres = coordinatorLease.infra.postgres;
  const mailpit = coordinatorLease.infra.mailpit;
  if (postgres === undefined || mailpit === undefined) {
    await coordinatorLease.release();
    throw new Error(
      `Shared infra key ${input.key} did not provide both postgres and mailpit services.`,
    );
  }

  return {
    infra: {
      postgres,
      mailpit,
      containerHostGateway: coordinatorLease.infra.containerHostGateway,
    },
    release: coordinatorLease.release,
  };
}

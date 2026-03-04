import type { MailpitService } from "./mailpit/index.js";
import { acquireSharedInfraCoordinatorLease } from "./shared-infra-coordinator.js";

export type SharedMailpitInfra = {
  mailpit: MailpitService;
  containerHostGateway: string;
};

export type AcquireSharedMailpitInfraInput = {
  key: string;
};

export type SharedMailpitLease = {
  infra: SharedMailpitInfra;
  release: () => Promise<void>;
};

export async function acquireSharedMailpitInfra(
  input: AcquireSharedMailpitInfraInput,
): Promise<SharedMailpitLease> {
  const coordinatorLease = await acquireSharedInfraCoordinatorLease({
    key: input.key,
    postgres: undefined,
    mailpit: true,
  });

  const mailpit = coordinatorLease.infra.mailpit;
  if (mailpit === undefined) {
    await coordinatorLease.release();
    throw new Error(`Shared infra key ${input.key} did not provide mailpit service.`);
  }

  return {
    infra: {
      mailpit,
      containerHostGateway: coordinatorLease.infra.containerHostGateway,
    },
    release: coordinatorLease.release,
  };
}

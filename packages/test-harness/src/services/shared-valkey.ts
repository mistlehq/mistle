import { acquireSharedInfraCoordinatorLease } from "./shared-infra-coordinator.js";
import type { ValkeyService } from "./valkey/index.js";

export type SharedValkeyInfra = {
  valkey: ValkeyService;
  containerHostGateway: string;
};

export type AcquireSharedValkeyInfraInput = {
  key: string;
};

export type SharedValkeyLease = {
  infra: SharedValkeyInfra;
  release: () => Promise<void>;
};

export async function acquireSharedValkeyInfra(
  input: AcquireSharedValkeyInfraInput,
): Promise<SharedValkeyLease> {
  const coordinatorLease = await acquireSharedInfraCoordinatorLease({
    key: input.key,
    postgres: undefined,
    mailpit: false,
    valkey: true,
  });

  const valkey = coordinatorLease.infra.valkey;
  if (valkey === undefined) {
    await coordinatorLease.release();
    throw new Error(`Shared infra key ${input.key} did not provide valkey service.`);
  }

  return {
    infra: {
      valkey,
      containerHostGateway: coordinatorLease.infra.containerHostGateway,
    },
    release: coordinatorLease.release,
  };
}

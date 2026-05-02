import type { SeaweedfsS3Service } from "./seaweedfs/index.js";
import { acquireSharedInfraCoordinatorLease } from "./shared-infra-coordinator.js";

export type SharedSeaweedfsInfra = {
  seaweedfs: SeaweedfsS3Service;
  containerHostGateway: string;
};

export type AcquireSharedSeaweedfsInfraInput = {
  key: string;
};

export type SharedSeaweedfsLease = {
  infra: SharedSeaweedfsInfra;
  release: () => Promise<void>;
};

export async function acquireSharedSeaweedfsInfra(
  input: AcquireSharedSeaweedfsInfraInput,
): Promise<SharedSeaweedfsLease> {
  const coordinatorLease = await acquireSharedInfraCoordinatorLease({
    key: input.key,
    postgres: undefined,
    mailpit: false,
    seaweedfs: true,
    valkey: false,
  });

  const seaweedfs = coordinatorLease.infra.seaweedfs;
  if (seaweedfs === undefined) {
    await coordinatorLease.release();
    throw new Error(`Shared infra key ${input.key} did not provide seaweedfs service.`);
  }

  return {
    infra: {
      seaweedfs,
      containerHostGateway: coordinatorLease.infra.containerHostGateway,
    },
    release: coordinatorLease.release,
  };
}

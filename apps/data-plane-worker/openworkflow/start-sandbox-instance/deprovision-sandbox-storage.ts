import { Archil } from "@archildata/client/api";
import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxStorageProviders,
  type DataPlaneDatabase,
  type SandboxInstanceStorage,
} from "@mistle/db/data-plane";

import type { DataPlaneWorkerConfig } from "../core/config.js";
import {
  deleteSandboxInstanceStorageBySandboxInstanceId,
  getSandboxInstanceStorageBySandboxInstanceId,
  resolveArchilProvisioningProfile,
} from "./provision-sandbox-storage.js";

function requireArchilSandboxStorage(input: {
  sandboxInstanceId: string;
  storage: SandboxInstanceStorage;
}): SandboxInstanceStorage & {
  provider: typeof SandboxStorageProviders.ARCHIL;
} {
  const archilProvider = SandboxStorageProviders.ARCHIL;

  if (input.storage.provider !== SandboxStorageProviders.ARCHIL) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' must use provider '${archilProvider}'.`,
    );
  }

  return input.storage;
}

export async function deprovisionSandboxStorage(input: {
  db: DataPlaneDatabase;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  workerConfig: DataPlaneWorkerConfig;
  organizationId: string;
  sandboxInstanceId: string;
}): Promise<void> {
  const existingStorage = await getSandboxInstanceStorageBySandboxInstanceId(
    {
      db: input.db,
    },
    {
      sandboxInstanceId: input.sandboxInstanceId,
    },
  );

  if (existingStorage === undefined) {
    return;
  }

  const storage = requireArchilSandboxStorage({
    sandboxInstanceId: input.sandboxInstanceId,
    storage: existingStorage,
  });

  const resolvedStorageConfiguration =
    await input.controlPlaneInternalClient.resolveStorageConfiguration({
      organizationId: input.organizationId,
      runtimeProvider: "e2b",
    });

  const archilProfile = resolveArchilProvisioningProfile({
    managedArchilConfig: input.workerConfig.sandboxStorage?.archil,
    resolvedStorageConfiguration,
  });

  const archil = new Archil({
    apiKey: archilProfile.apiKey,
    region: storage.region,
  });

  let diskDeleteError: unknown;
  try {
    const disk = await archil.disks.get(storage.handle);
    await disk.delete();
  } catch (error) {
    diskDeleteError = error;
  }

  let deleteSandboxInstanceStorageError: unknown;
  try {
    await deleteSandboxInstanceStorageBySandboxInstanceId(
      {
        db: input.db,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
      },
    );
  } catch (error) {
    deleteSandboxInstanceStorageError = error;
  }

  if (diskDeleteError !== undefined && deleteSandboxInstanceStorageError !== undefined) {
    throw new Error(
      `Failed to delete Archil sandbox storage disk and failed to delete sandbox storage row for sandbox instance '${input.sandboxInstanceId}'.`,
      {
        cause: {
          diskDeleteError,
          deleteSandboxInstanceStorageError,
        },
      },
    );
  }

  if (diskDeleteError !== undefined) {
    throw new Error(
      `Failed to delete Archil sandbox storage disk for sandbox instance '${input.sandboxInstanceId}'.`,
      {
        cause: diskDeleteError,
      },
    );
  }

  if (deleteSandboxInstanceStorageError !== undefined) {
    throw new Error(
      `Failed to delete sandbox storage row for sandbox instance '${input.sandboxInstanceId}'.`,
      {
        cause: deleteSandboxInstanceStorageError,
      },
    );
  }
}

import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { type DataPlaneDatabase } from "@mistle/db/data-plane";
import { SandboxProvider, SandboxStorageBackend } from "@mistle/sandbox";

import type { DataPlaneWorkerConfig } from "../../core/config.js";
import { createArchilSandboxStorageBackendAdapter } from "./archil-storage-backend.js";
import type { SandboxStorageBackendAdapter } from "./backend.js";

export function createSandboxStorageBackendAdapter(input: {
  db: DataPlaneDatabase;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  workerConfig: DataPlaneWorkerConfig;
  runtimeProvider: SandboxProvider;
  storageBackend: SandboxStorageBackend | undefined;
}): SandboxStorageBackendAdapter {
  if (input.storageBackend === undefined) {
    throw new Error(
      `Sandbox storage backend is required for persistent sandbox runtime provider '${input.runtimeProvider}'.`,
    );
  }

  if (
    input.runtimeProvider === SandboxProvider.E2B &&
    input.storageBackend === SandboxStorageBackend.ARCHIL
  ) {
    return createArchilSandboxStorageBackendAdapter({
      db: input.db,
      controlPlaneInternalClient: input.controlPlaneInternalClient,
      workerConfig: input.workerConfig,
      runtimeProvider: SandboxProvider.E2B,
    });
  }

  throw new Error(
    `Sandbox storage backend '${input.storageBackend}' is not supported for runtime provider '${input.runtimeProvider}'.`,
  );
}

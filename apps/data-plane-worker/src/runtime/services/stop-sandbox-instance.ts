import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type SandboxInstanceProvider,
} from "@mistle/db/data-plane";
import type { SandboxAdapter } from "@mistle/sandbox";
import { isSandboxResourceNotFoundError } from "@mistle/sandbox";

import type { DataPlaneWorkerRuntimeConfig } from "../../types.js";
import { stopSandbox } from "./stop-sandbox.js";
import type { StopSandboxInstanceInput } from "./types.js";
import { markSandboxInstanceStopped } from "./update-sandbox-instance-status.js";

type RunningSandboxInstanceStopState = {
  provider: SandboxInstanceProvider;
  providerSandboxId: string;
};

async function resolveRunningSandboxInstanceStopState(input: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<RunningSandboxInstanceStopState | null> {
  const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
    columns: {
      provider: true,
      providerSandboxId: true,
      status: true,
    },
    where: (table, { eq }) => eq(table.id, input.sandboxInstanceId),
  });

  if (sandboxInstance === undefined) {
    throw new Error(`Sandbox instance '${input.sandboxInstanceId}' was not found.`);
  }

  if (sandboxInstance.status === SandboxInstanceStatuses.STOPPED) {
    return null;
  }

  if (sandboxInstance.status !== SandboxInstanceStatuses.RUNNING) {
    throw new Error(
      `Expected sandbox instance '${input.sandboxInstanceId}' to be running or stopped before stop execution.`,
    );
  }

  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected running sandbox instance '${input.sandboxInstanceId}' to have a providerSandboxId.`,
    );
  }

  return {
    provider: sandboxInstance.provider,
    providerSandboxId: sandboxInstance.providerSandboxId,
  };
}

export async function stopSandboxInstance(
  deps: {
    config: DataPlaneWorkerRuntimeConfig;
    db: DataPlaneDatabase;
    sandboxAdapter: SandboxAdapter;
  },
  input: StopSandboxInstanceInput,
): Promise<void> {
  const sandboxInstanceState = await resolveRunningSandboxInstanceStopState({
    db: deps.db,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (sandboxInstanceState === null) {
    return;
  }

  try {
    await stopSandbox(
      {
        config: deps.config,
        sandboxAdapter: deps.sandboxAdapter,
      },
      {
        provider: sandboxInstanceState.provider,
        providerSandboxId: sandboxInstanceState.providerSandboxId,
      },
    );
  } catch (error) {
    if (!isSandboxResourceNotFoundError(error)) {
      throw error;
    }
  }

  await markSandboxInstanceStopped({
    db: deps.db,
    sandboxInstanceId: input.sandboxInstanceId,
  });
}

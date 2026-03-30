import { SandboxInstanceStatuses } from "@mistle/db/data-plane";

import type { SandboxRuntimeStateSnapshot } from "../../runtime-state/sandbox-runtime-state-reader.js";
import { isSandboxRuntimeReady } from "../../runtime-state/sandbox-runtime-state-readiness.js";
import { DataPlaneSandboxInstanceStatuses, type GetSandboxInstanceResponse } from "./schemas.js";

/**
 * Composes the effective user-facing sandbox status from durable lifecycle
 * state and live gateway attachment state.
 *
 * Durable `pending`, `failed`, and `stopped` states always win. For durable `starting` and
 * `running`, gateway attachment determines whether the sandbox is effectively
 * `running` or still `starting`.
 */
export function resolveEffectiveSandboxInstanceStatus(input: {
  persistedStatus: string;
  runtimeStateSnapshot: SandboxRuntimeStateSnapshot | null;
}): NonNullable<GetSandboxInstanceResponse>["status"] {
  if (input.persistedStatus === SandboxInstanceStatuses.PENDING) {
    return DataPlaneSandboxInstanceStatuses.PENDING;
  }

  if (input.persistedStatus === SandboxInstanceStatuses.FAILED) {
    return DataPlaneSandboxInstanceStatuses.FAILED;
  }

  if (input.persistedStatus === SandboxInstanceStatuses.STOPPED) {
    return DataPlaneSandboxInstanceStatuses.STOPPED;
  }

  if (
    input.persistedStatus !== SandboxInstanceStatuses.STARTING &&
    input.persistedStatus !== SandboxInstanceStatuses.RUNNING
  ) {
    throw new Error(`Unsupported sandbox status '${input.persistedStatus}'.`);
  }

  if (input.runtimeStateSnapshot !== null && isSandboxRuntimeReady(input.runtimeStateSnapshot)) {
    return DataPlaneSandboxInstanceStatuses.RUNNING;
  }

  return DataPlaneSandboxInstanceStatuses.STARTING;
}

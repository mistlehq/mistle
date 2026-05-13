import { SandboxInstanceStatuses } from "@mistle/db/data-plane";

import type { SandboxRuntimeStateSnapshot } from "../../runtime-state/sandbox-runtime-state-reader.js";
import {
  isSandboxBootstrapAttached,
  isSandboxRuntimeReady,
} from "../../runtime-state/sandbox-runtime-state-readiness.js";
import { DataPlaneSandboxInstanceStatuses, type GetSandboxInstanceResponse } from "./schemas.js";

/**
 * Composes the effective user-facing sandbox status from durable lifecycle
 * state, live gateway bootstrap attachment, and runtime readiness.
 *
 * Durable `pending` and `failed` states always win. For durable `stopped`,
 * `starting`, and `running`, bootstrap attachment can only move the sandbox to
 * `starting`. Runtime readiness is required before the effective status becomes
 * `running`.
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

  if (
    input.persistedStatus !== SandboxInstanceStatuses.STOPPED &&
    input.persistedStatus !== SandboxInstanceStatuses.STARTING &&
    input.persistedStatus !== SandboxInstanceStatuses.RUNNING
  ) {
    throw new Error(`Unsupported sandbox status '${input.persistedStatus}'.`);
  }

  if (input.runtimeStateSnapshot !== null && isSandboxRuntimeReady(input.runtimeStateSnapshot)) {
    return DataPlaneSandboxInstanceStatuses.RUNNING;
  }

  if (
    input.runtimeStateSnapshot !== null &&
    isSandboxBootstrapAttached(input.runtimeStateSnapshot)
  ) {
    return DataPlaneSandboxInstanceStatuses.STARTING;
  }

  if (input.persistedStatus === SandboxInstanceStatuses.STOPPED) {
    return DataPlaneSandboxInstanceStatuses.STOPPED;
  }

  return DataPlaneSandboxInstanceStatuses.STARTING;
}

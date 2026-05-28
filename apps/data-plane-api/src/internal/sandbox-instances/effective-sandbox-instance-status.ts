import {
  assertSandboxInstanceLifecycleStatus,
  getSandboxEffectiveStatus,
} from "@mistle/sandbox-lifecycle";

import type { SandboxRuntimeStateSnapshot } from "../../runtime-state/sandbox-runtime-state-reader.js";
import {
  isSandboxBootstrapAttached,
  isSandboxRuntimeReady,
} from "../../runtime-state/sandbox-runtime-state-readiness.js";
import type { GetSandboxInstanceResponse } from "./schemas.js";

/**
 * Composes the effective user-facing sandbox status from durable lifecycle
 * state, live gateway bootstrap attachment, and runtime readiness.
 *
 * Durable non-connectable states such as `pending`, `failed`, `reconnecting`,
 * and `stopping` win. Runtime readiness is required before the effective status
 * becomes `running`.
 */
export function resolveEffectiveSandboxInstanceStatus(input: {
  persistedStatus: string;
  runtimeStateSnapshot: SandboxRuntimeStateSnapshot | null;
}): NonNullable<GetSandboxInstanceResponse>["status"] {
  assertSandboxInstanceLifecycleStatus(input.persistedStatus);

  return getSandboxEffectiveStatus({
    persistedStatus: input.persistedStatus,
    runtimeReady:
      input.runtimeStateSnapshot !== null && isSandboxRuntimeReady(input.runtimeStateSnapshot),
    bootstrapAttached:
      input.runtimeStateSnapshot !== null && isSandboxBootstrapAttached(input.runtimeStateSnapshot),
  });
}

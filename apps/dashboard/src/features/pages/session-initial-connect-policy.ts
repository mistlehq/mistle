import type { SandboxInstanceStatusResult } from "../sessions/sessions-service.js";
import { resolveRuntimePlanPrimaryRepositoryCwd } from "./session-primary-repository-policy.js";

export type InitialSessionConnectTarget =
  | { type: "wait_for_runtime_plan" }
  | { type: "provider_thread"; threadId: string }
  | { type: "new_thread"; cwd?: string | null };

export function resolveInitialSessionConnectTarget(input: {
  connectable: boolean | null;
  providerThreadId: string | null;
  runtimePlan: SandboxInstanceStatusResult["runtimePlan"];
}): InitialSessionConnectTarget {
  if (input.providerThreadId !== null) {
    return {
      type: "provider_thread",
      threadId: input.providerThreadId,
    };
  }

  if (input.connectable === true && input.runtimePlan === null) {
    return {
      type: "wait_for_runtime_plan",
    };
  }

  const initialCwd = resolveRuntimePlanPrimaryRepositoryCwd({
    runtimePlan: input.runtimePlan,
  });

  return {
    type: "new_thread",
    ...(initialCwd === undefined ? {} : { cwd: initialCwd }),
  };
}

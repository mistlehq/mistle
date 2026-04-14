import type { SandboxInstanceStatusResult } from "../sessions/sessions-service.js";
import { resolveRuntimePlanPrimaryRepositoryCwd } from "./session-primary-repository-policy.js";

export type InitialSessionConnectTarget =
  | { type: "provider_thread"; threadId: string }
  | { type: "new_thread"; cwd?: string | null };

export const MissingConnectableRuntimePlanMessage =
  "Expected a connectable sandbox session to include a runtime plan.";

export function resolveInitialSessionConnectTarget(input: {
  connectable: boolean | null;
  providerThreadId: string | null;
  runtimePlan: SandboxInstanceStatusResult["runtimePlan"];
}): InitialSessionConnectTarget {
  if (input.connectable === true && input.runtimePlan === null) {
    throw new Error(MissingConnectableRuntimePlanMessage);
  }

  if (input.providerThreadId !== null) {
    return {
      type: "provider_thread",
      threadId: input.providerThreadId,
    };
  }

  const initialCwd = resolveRuntimePlanPrimaryRepositoryCwd({
    runtimePlan: input.runtimePlan,
  });

  return {
    type: "new_thread",
    ...(initialCwd === undefined || initialCwd === null ? {} : { cwd: initialCwd }),
  };
}

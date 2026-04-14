import type { SandboxInstanceStatusResult } from "../sessions/sessions-service.js";

export type InitialSessionConnectTarget =
  | { type: "provider_thread"; threadId: string }
  | { type: "new_thread"; cwd?: string | null };

export const MissingConnectableRuntimeContextMessage =
  "Expected a connectable sandbox session to include runtime context.";

export function resolveInitialSessionConnectTarget(input: {
  connectable: boolean | null;
  providerThreadId: string | null;
  runtimeContext: SandboxInstanceStatusResult["runtimeContext"];
}): InitialSessionConnectTarget {
  if (input.connectable === true && input.runtimeContext === null) {
    throw new Error(MissingConnectableRuntimeContextMessage);
  }

  if (input.providerThreadId !== null) {
    return {
      type: "provider_thread",
      threadId: input.providerThreadId,
    };
  }

  const initialCwd = input.runtimeContext?.launchCwd;

  return {
    type: "new_thread",
    ...(initialCwd === undefined || initialCwd === null ? {} : { cwd: initialCwd }),
  };
}

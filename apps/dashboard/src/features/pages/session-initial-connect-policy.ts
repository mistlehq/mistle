import type { SandboxInstanceRuntimeContext } from "../sessions/sessions-service.js";

export const MissingConnectableRuntimeContextMessage =
  "Expected a connectable sandbox session to include runtime context.";

export type InitialSessionConnectInput =
  | {
      initialCwd?: never;
      providerThreadId?: string | null;
      sandboxInstanceId: string;
      targetThreadId: string;
      selectionPolicy?: never;
    }
  | {
      initialCwd?: string | null;
      providerThreadId?: never;
      selectionPolicy?: "most_recently_updated";
      sandboxInstanceId: string;
      targetThreadId: null;
    };

export function resolveInitialSessionConnectInput(input: {
  connectable: boolean | null;
  providerThreadId: string | null;
  requestedThreadId?: string | null;
  runtimeContext: SandboxInstanceRuntimeContext | null;
  sandboxInstanceId: string;
}): InitialSessionConnectInput {
  if (input.connectable === true && input.runtimeContext === null) {
    throw new Error(MissingConnectableRuntimeContextMessage);
  }

  if (input.runtimeContext === null) {
    throw new Error("Runtime context is required to connect a session.");
  }

  if (input.providerThreadId !== null) {
    return {
      providerThreadId: input.providerThreadId,
      sandboxInstanceId: input.sandboxInstanceId,
      targetThreadId: input.providerThreadId,
    };
  }

  if (input.requestedThreadId !== undefined && input.requestedThreadId !== null) {
    return {
      sandboxInstanceId: input.sandboxInstanceId,
      targetThreadId: input.requestedThreadId,
    };
  }

  const initialCwd = input.runtimeContext.launchCwd;

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    targetThreadId: null,
    selectionPolicy: "most_recently_updated",
    ...(initialCwd === undefined || initialCwd === null ? {} : { initialCwd }),
  };
}

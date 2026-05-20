import type { SandboxInstanceRuntimeContext } from "../sessions/sessions-service.js";

export const MissingConnectableRuntimeContextMessage =
  "Expected a connectable sandbox session to include runtime context.";

export type InitialSessionConnectInput =
  | {
      initialCwd?: never;
      providerConversationId?: string | null;
      sandboxInstanceId: string;
      targetRuntimeConversationId: string;
      selectionPolicy?: never;
    }
  | {
      initialCwd?: string | null;
      providerConversationId?: never;
      selectionPolicy?: "most_recently_updated";
      sandboxInstanceId: string;
      targetRuntimeConversationId: null;
    };

export function resolveInitialSessionConnectInput(input: {
  connectable: boolean | null;
  providerConversationId: string | null;
  requestedRuntimeConversationId?: string | null;
  runtimeContext: SandboxInstanceRuntimeContext | null;
  sandboxInstanceId: string;
}): InitialSessionConnectInput {
  if (input.connectable === true && input.runtimeContext === null) {
    throw new Error(MissingConnectableRuntimeContextMessage);
  }

  if (input.runtimeContext === null) {
    throw new Error("Runtime context is required to connect a session.");
  }

  if (input.providerConversationId !== null) {
    return {
      providerConversationId: input.providerConversationId,
      sandboxInstanceId: input.sandboxInstanceId,
      targetRuntimeConversationId: input.providerConversationId,
    };
  }

  if (
    input.requestedRuntimeConversationId !== undefined &&
    input.requestedRuntimeConversationId !== null
  ) {
    return {
      sandboxInstanceId: input.sandboxInstanceId,
      targetRuntimeConversationId: input.requestedRuntimeConversationId,
    };
  }

  const initialCwd = input.runtimeContext.launchCwd;

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    targetRuntimeConversationId: null,
    selectionPolicy: "most_recently_updated",
    ...(initialCwd === undefined || initialCwd === null ? {} : { initialCwd }),
  };
}

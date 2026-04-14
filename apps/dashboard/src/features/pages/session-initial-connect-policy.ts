import type { ConnectCodexSessionInput } from "../session-agents/codex/session-state/session-connection/use-codex-session-connection.js";
import type { SandboxInstanceRuntimeContext } from "../sessions/sessions-service.js";

export const MissingConnectableRuntimeContextMessage =
  "Expected a connectable sandbox session to include runtime context.";

export function resolveInitialSessionConnectInput(input: {
  connectable: boolean | null;
  providerThreadId: string | null;
  runtimeContext: SandboxInstanceRuntimeContext | null;
  sandboxInstanceId: string;
}): ConnectCodexSessionInput {
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

  const initialCwd = input.runtimeContext.launchCwd;

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    targetThreadId: null,
    ...(initialCwd === undefined || initialCwd === null ? {} : { initialCwd }),
  };
}

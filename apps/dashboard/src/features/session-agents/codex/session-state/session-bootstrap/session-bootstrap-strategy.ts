import type { ConnectedCodexSession } from "../codex-session-types.js";

export type SessionBootstrapStrategy = "disconnected" | "full" | "refresh" | "thread_sync";

export function resolveSessionBootstrapStrategy(input: {
  connectedSession: ConnectedCodexSession | null;
  establishedConnectionAtIso: string | null;
  establishedSandboxInstanceId: string | null;
  hasEstablishedBaseline: boolean;
}): SessionBootstrapStrategy {
  if (input.connectedSession === null || input.connectedSession.threadId === null) {
    return "disconnected";
  }

  if (!input.hasEstablishedBaseline) {
    return "full";
  }

  if (input.establishedSandboxInstanceId !== input.connectedSession.sandboxInstanceId) {
    return "full";
  }

  if (input.establishedConnectionAtIso !== input.connectedSession.connectedAtIso) {
    return "refresh";
  }

  return "thread_sync";
}

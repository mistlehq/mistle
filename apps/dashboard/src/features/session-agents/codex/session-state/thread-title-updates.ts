import type { ConnectedCodexSession, CodexThreadNameUpdate } from "./codex-session-types.js";

export function resolveThreadTitlePatchInput(input: {
  sessionSnapshot: ConnectedCodexSession | null;
  threadNameUpdate: CodexThreadNameUpdate | null;
}): {
  sandboxInstanceId: string;
  title: string;
} | null {
  if (input.sessionSnapshot === null || input.threadNameUpdate === null) {
    return null;
  }

  if (input.sessionSnapshot.providerThreadId !== input.threadNameUpdate.threadId) {
    return null;
  }

  return {
    sandboxInstanceId: input.sessionSnapshot.sandboxInstanceId,
    title: input.threadNameUpdate.title,
  };
}

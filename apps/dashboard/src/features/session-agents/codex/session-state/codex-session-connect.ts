import {
  CodexJsonRpcRequestError,
  resumeCodexThread,
  startCodexThread,
  type CodexJsonRpcClient,
  type CodexThreadSummary,
} from "@mistle/integrations-definitions/openai/agent/client";

import type { MintSandboxConnectionTokenResult } from "../../../sessions/sessions-service.js";
import { describeCodexSessionStepError } from "./codex-session-errors.js";
import { selectCodexConnectionThreadStrategy } from "./codex-session-lifecycle-policy.js";
import type { ConnectedCodexSession } from "./codex-session-types.js";

const DefaultCodexModel = "gpt-5.3-codex";

function isMissingPersistedThreadError(error: unknown): boolean {
  if (!(error instanceof CodexJsonRpcRequestError)) {
    return false;
  }

  return (
    error.message.startsWith("JSON-RPC request") &&
    (error.message.includes("invalid thread id:") || error.message.includes("thread not found:"))
  );
}

export type CodexConnectionBootstrapResult = {
  generation: number;
  sandboxInstanceId: string;
  mintedConnection: MintSandboxConnectionTokenResult;
  threadId: string;
};

export function resolveInitialCodexThreadAction(input: {
  preferredThreadId: string | null;
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
}) {
  return selectCodexConnectionThreadStrategy({
    preferredThreadId: input.preferredThreadId,
    availableThreads: input.availableThreads,
    loadedThreadIds: input.loadedThreadIds,
  });
}

export async function establishInitialCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  preferredThreadId: string | null;
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
  generation: number;
  sandboxInstanceId: string;
  mintedConnection: MintSandboxConnectionTokenResult;
  ensureCurrentGeneration: (generation: number) => void;
}): Promise<CodexConnectionBootstrapResult> {
  const action = resolveInitialCodexThreadAction({
    preferredThreadId: input.preferredThreadId,
    availableThreads: input.availableThreads,
    loadedThreadIds: input.loadedThreadIds,
  });

  if (action.type === "resume") {
    let resumedThread;
    try {
      resumedThread = await resumeCodexThread({
        rpcClient: input.rpcClient,
        threadId: action.threadId,
      });
    } catch (error) {
      if (
        input.preferredThreadId !== null &&
        action.threadId === input.preferredThreadId &&
        isMissingPersistedThreadError(error)
      ) {
        throw describeCodexSessionStepError(
          "Resuming persisted Codex thread",
          new Error(
            `This session is linked to persisted Codex thread '${input.preferredThreadId}', but that thread is no longer available.`,
          ),
        );
      }

      throw error;
    }
    input.ensureCurrentGeneration(input.generation);

    return {
      generation: input.generation,
      sandboxInstanceId: input.sandboxInstanceId,
      mintedConnection: input.mintedConnection,
      threadId: resumedThread.threadId,
    };
  }

  const startedThread = await startCodexThread({
    rpcClient: input.rpcClient,
    model: DefaultCodexModel,
  });
  input.ensureCurrentGeneration(input.generation);

  return {
    generation: input.generation,
    sandboxInstanceId: input.sandboxInstanceId,
    mintedConnection: input.mintedConnection,
    threadId: startedThread.threadId,
  };
}

export function createConnectedCodexSession(input: {
  sandboxInstanceId: string;
  connectedAtIso: string;
  mintedConnection: MintSandboxConnectionTokenResult;
  threadId: string;
}): ConnectedCodexSession {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    connectedAtIso: input.connectedAtIso,
    expiresAtIso: input.mintedConnection.connectionExpiresAt,
    threadId: input.threadId,
  };
}

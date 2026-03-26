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

function isNoRolloutPersistedThreadError(error: unknown): boolean {
  if (!(error instanceof CodexJsonRpcRequestError)) {
    return false;
  }

  return (
    error.message.startsWith("JSON-RPC request") &&
    error.message.includes("no rollout found for thread id ")
  );
}

export type ReconnectResumeFailureAction = "error_broken_persisted" | "start_new" | "rethrow";

export function resolveReconnectResumeFailureAction(input: {
  error: unknown;
  preferredThreadId: string | null;
  selectedThreadId: string;
}): ReconnectResumeFailureAction {
  if (
    input.preferredThreadId !== null &&
    input.selectedThreadId === input.preferredThreadId &&
    (isMissingPersistedThreadError(input.error) || isNoRolloutPersistedThreadError(input.error))
  ) {
    return "error_broken_persisted";
  }

  if (isMissingPersistedThreadError(input.error) || isNoRolloutPersistedThreadError(input.error)) {
    return "start_new";
  }

  return "rethrow";
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
      const failureAction = resolveReconnectResumeFailureAction({
        error,
        preferredThreadId: input.preferredThreadId,
        selectedThreadId: action.threadId,
      });

      if (failureAction === "error_broken_persisted") {
        throw describeCodexSessionStepError(
          "Resuming persisted chat session",
          new Error(
            `This chat session could not be resumed because the linked persisted session '${input.preferredThreadId}' is no longer resumable.`,
          ),
        );
      }

      if (failureAction === "start_new") {
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
    connectionUrl: input.mintedConnection.connectionUrl,
    threadId: input.threadId,
  };
}

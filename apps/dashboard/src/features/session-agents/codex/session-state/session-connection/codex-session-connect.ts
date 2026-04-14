import {
  CodexJsonRpcRequestError,
  resumeCodexThread,
  startCodexThread,
  type CodexJsonRpcClient,
  type CodexThreadSummary,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";

import type { ThreadSelectionPolicy } from "../../../../sessions/thread-selection.js";
import type { ConnectedCodexSession } from "../codex-session-types.js";
import { describeCodexSessionStepError } from "./codex-session-errors.js";
import { selectCodexConnectionThreadStrategy } from "./codex-session-lifecycle-policy.js";

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
  targetThreadId: string | null;
  selectedThreadId: string;
}): ReconnectResumeFailureAction {
  if (
    input.targetThreadId !== null &&
    input.selectedThreadId === input.targetThreadId &&
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
  resolvedThreadId: string | null;
  threadId: string;
};

export type EstablishedCodexThreadResult = {
  generation: number;
  sandboxInstanceId: string;
  resolvedThreadId: string | null;
  threadId: string;
};

export function resolveInitialCodexThreadAction(input: {
  targetThreadId: string | null;
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
  selectionPolicy?: ThreadSelectionPolicy;
}) {
  return selectCodexConnectionThreadStrategy({
    targetThreadId: input.targetThreadId,
    availableThreads: input.availableThreads,
    loadedThreadIds: input.loadedThreadIds,
    ...(input.selectionPolicy === undefined ? {} : { selectionPolicy: input.selectionPolicy }),
  });
}

export async function establishCodexThread(input: {
  initialCwd?: string | null;
  rpcClient: CodexJsonRpcClient;
  targetThreadId: string | null;
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
  selectionPolicy?: ThreadSelectionPolicy;
  generation: number;
  sandboxInstanceId: string;
  ensureCurrentGeneration: (generation: number) => void;
}): Promise<EstablishedCodexThreadResult> {
  const action = resolveInitialCodexThreadAction({
    targetThreadId: input.targetThreadId,
    availableThreads: input.availableThreads,
    loadedThreadIds: input.loadedThreadIds,
    ...(input.selectionPolicy === undefined ? {} : { selectionPolicy: input.selectionPolicy }),
  });
  const resolvedThreadId = action.type === "resume" ? action.threadId : null;

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
        targetThreadId: input.targetThreadId,
        selectedThreadId: action.threadId,
      });

      if (failureAction === "error_broken_persisted") {
        throw describeCodexSessionStepError(
          "Resuming persisted chat session",
          new Error(
            `This chat session could not be resumed because the linked persisted session '${input.targetThreadId}' is no longer resumable.`,
          ),
        );
      }

      if (failureAction === "start_new") {
        const startedThread = await startCodexThread({
          ...(input.initialCwd === undefined || input.initialCwd === null
            ? {}
            : { cwd: input.initialCwd }),
          rpcClient: input.rpcClient,
          model: DefaultCodexModel,
        });
        input.ensureCurrentGeneration(input.generation);

        return {
          generation: input.generation,
          sandboxInstanceId: input.sandboxInstanceId,
          resolvedThreadId,
          threadId: startedThread.threadId,
        };
      }

      throw error;
    }
    input.ensureCurrentGeneration(input.generation);

    return {
      generation: input.generation,
      sandboxInstanceId: input.sandboxInstanceId,
      resolvedThreadId,
      threadId: resumedThread.threadId,
    };
  }

  const startedThread = await startCodexThread({
    ...(input.initialCwd === undefined || input.initialCwd === null
      ? {}
      : { cwd: input.initialCwd }),
    rpcClient: input.rpcClient,
    model: DefaultCodexModel,
  });
  input.ensureCurrentGeneration(input.generation);

  return {
    generation: input.generation,
    sandboxInstanceId: input.sandboxInstanceId,
    resolvedThreadId,
    threadId: startedThread.threadId,
  };
}

export async function establishInitialCodexThread(input: {
  initialCwd?: string | null;
  rpcClient: CodexJsonRpcClient;
  targetThreadId: string | null;
  availableThreads: readonly CodexThreadSummary[];
  loadedThreadIds: readonly string[];
  selectionPolicy?: ThreadSelectionPolicy;
  generation: number;
  sandboxInstanceId: string;
  ensureCurrentGeneration: (generation: number) => void;
}): Promise<CodexConnectionBootstrapResult> {
  return await establishCodexThread(input);
}

export function createConnectedCodexSession(input: {
  sandboxInstanceId: string;
  connectedAtIso: string;
  providerThreadId: string | null;
  activeThreadId: string;
}): ConnectedCodexSession {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    connectedAtIso: input.connectedAtIso,
    providerThreadId: input.providerThreadId,
    activeThreadId: input.activeThreadId,
  };
}

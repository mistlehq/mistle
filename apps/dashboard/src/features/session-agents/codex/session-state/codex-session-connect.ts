import {
  resumeCodexThread,
  startCodexThread,
  type CodexJsonRpcClient,
  type CodexThreadSummary,
} from "@mistle/integrations-definitions/openai/agent/client";

import type { MintSandboxConnectionTokenResult } from "../../../sessions/sessions-service.js";
import { selectCodexConnectionThreadStrategy } from "./codex-session-lifecycle-policy.js";
import type { ConnectedCodexSession } from "./codex-session-types.js";

const DefaultCodexModel = "gpt-5.3-codex";

export type CodexConnectionBootstrapResult = {
  generation: number;
  sandboxInstanceId: string;
  mintedConnection: MintSandboxConnectionTokenResult;
  threadId: string;
};

export function resolveInitialCodexThreadAction(input: {
  availableThreads: readonly CodexThreadSummary[];
}) {
  return selectCodexConnectionThreadStrategy({
    availableThreads: input.availableThreads,
  });
}

export async function establishInitialCodexThread(input: {
  rpcClient: CodexJsonRpcClient;
  availableThreads: readonly CodexThreadSummary[];
  generation: number;
  sandboxInstanceId: string;
  mintedConnection: MintSandboxConnectionTokenResult;
  ensureCurrentGeneration: (generation: number) => void;
}): Promise<CodexConnectionBootstrapResult> {
  const action = resolveInitialCodexThreadAction({
    availableThreads: input.availableThreads,
  });

  if (action.type === "resume") {
    const resumedThread = await resumeCodexThread({
      rpcClient: input.rpcClient,
      threadId: action.threadId,
    });
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

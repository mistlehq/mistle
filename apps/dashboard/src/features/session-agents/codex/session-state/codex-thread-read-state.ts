import {
  readCodexThread,
  type CodexJsonRpcClient,
  type CodexThreadReadTurn,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";

type MaterializedCodexThreadReadState = {
  threadId: string;
  turns: readonly CodexThreadReadTurn[];
  response: unknown;
  status: "materialized";
};

export type CodexThreadReadState =
  | MaterializedCodexThreadReadState
  | {
      threadId: string;
      turns: [];
      response: null;
      status: "unmaterialized";
    };

export function isCodexThreadNotMaterializedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("includeTurns is unavailable before first user message");
}

export async function readCodexThreadState(input: {
  rpcClient: CodexJsonRpcClient;
  threadId: string;
}): Promise<CodexThreadReadState> {
  try {
    const thread = await readCodexThread(input);
    return {
      ...thread,
      status: "materialized",
    };
  } catch (error) {
    if (!isCodexThreadNotMaterializedError(error)) {
      throw error;
    }

    return {
      threadId: input.threadId,
      turns: [],
      response: null,
      status: "unmaterialized",
    };
  }
}

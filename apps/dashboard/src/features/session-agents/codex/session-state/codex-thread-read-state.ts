import {
  readCodexThread,
  type CodexJsonRpcClient,
} from "@mistle/integrations-definitions/openai/agent/client";

export type CodexThreadReadState =
  | (Awaited<ReturnType<typeof readCodexThread>> & {
      status: "materialized";
    })
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

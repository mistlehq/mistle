import {
  buildCodexThreadStartRequest,
  parseCodexThreadReadResponse,
  parseCodexThreadSessionResponse,
} from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { systemScheduler } from "@mistle/time";

import { DashboardControlDynamicToolSpecs } from "../../../../apps/dashboard/src/features/session-agents/dashboard-control-actions.ts";
import type { DirectCodexJsonRpcClient } from "../runtime/direct-codex-json-rpc-client.ts";

export async function startDesignerEvalCodexThread(input: {
  rpcClient: DirectCodexJsonRpcClient;
}): Promise<{ threadId: string; cwd: string; response: unknown }> {
  const response = await input.rpcClient.call(
    "thread/start",
    buildCodexThreadStartRequest({
      dynamicTools: DashboardControlDynamicToolSpecs,
    }),
  );
  const parsed = parseCodexThreadSessionResponse({
    method: "thread/start",
    response,
  });

  return {
    threadId: parsed.threadId,
    cwd: parsed.cwd,
    response,
  };
}

export async function readDesignerEvalCodexThread(input: {
  rpcClient: DirectCodexJsonRpcClient;
  threadId: string;
}): Promise<{
  threadId: string;
  name: string | null;
  preview: string | null;
  turns: readonly { id: string; status: string | null; items: readonly unknown[] }[];
  response: unknown;
}> {
  const response = await input.rpcClient.call("thread/read", {
    threadId: input.threadId,
    includeTurns: true,
  });

  return parseCodexThreadReadResponse(response);
}

export async function runDesignerEvalCodexTurns(input: {
  afterTurnStarted: (turnIndex: number) => void;
  prompts: readonly string[];
  rpcClient: DirectCodexJsonRpcClient;
  serverRequestFailure: Promise<never>;
  threadId: string;
}): Promise<{ threadId: string; turnId: string }> {
  let completedTurn: { threadId: string; turnId: string } | undefined;
  for (const [turnIndex, prompt] of input.prompts.entries()) {
    input.afterTurnStarted(turnIndex);
    completedTurn = await Promise.race([
      waitForDesignerTurnCompletion({
        rpcClient: input.rpcClient,
        threadId: input.threadId,
        prompt,
      }),
      input.serverRequestFailure,
    ]);
  }
  if (completedTurn === undefined) {
    throw new Error("Designer eval case did not provide a prompt.");
  }

  return completedTurn;
}

async function waitForDesignerTurnCompletion(input: {
  rpcClient: DirectCodexJsonRpcClient;
  threadId: string;
  prompt: string;
}): Promise<{ threadId: string; turnId: string }> {
  return await new Promise((resolve, reject) => {
    const timeout = systemScheduler.schedule(
      () => {
        unsubscribe();
        reject(new Error("Timed out waiting for Designer turn completion."));
      },
      10 * 60 * 1000,
    );

    const unsubscribe = input.rpcClient.onNotification((notification) => {
      if (notification.method !== "turn/completed") {
        return;
      }
      const params = notification.params;
      if (typeof params !== "object" || params === null) {
        return;
      }
      const threadId = Reflect.get(params, "threadId");
      const turnId = readCompletedTurnId(params);
      if (threadId !== input.threadId || typeof turnId !== "string") {
        return;
      }
      systemScheduler.cancel(timeout);
      unsubscribe();
      resolve({
        threadId,
        turnId,
      });
    });

    void input.rpcClient
      .call("turn/start", {
        threadId: input.threadId,
        input: [
          {
            type: "text",
            text: input.prompt,
          },
        ],
      })
      .catch((error: unknown) => {
        systemScheduler.cancel(timeout);
        unsubscribe();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

function readCompletedTurnId(params: object): string | undefined {
  const topLevelTurnId = Reflect.get(params, "turnId");
  if (typeof topLevelTurnId === "string") {
    return topLevelTurnId;
  }

  const turn = Reflect.get(params, "turn");
  if (typeof turn !== "object" || turn === null) {
    return undefined;
  }

  const nestedTurnId = Reflect.get(turn, "id");
  return typeof nestedTurnId === "string" ? nestedTurnId : undefined;
}

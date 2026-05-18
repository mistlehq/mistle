/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { randomUUID } from "node:crypto";

import {
  resumeCodexThread,
  unsubscribeCodexThread,
} from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { describe, expect } from "vitest";

import {
  hasRequiredGitHubWebhookTriggerEnv,
  startGitHubWebhookTriggerConversation,
  TestTimeoutMs,
  ThreadReadTimeoutMs,
  triggerGitHubWebhookTriggerFollowUp,
  waitForCodexPersistedUserMessageText,
} from "./helpers/github-webhook-trigger.js";
import { it } from "./system-test-context.js";

const describeIf = hasRequiredGitHubWebhookTriggerEnv() ? describe : describe.skip;

describeIf("system GitHub webhook trigger thread resume", () => {
  it(
    "reuses the same Codex thread after client unsubscribe and reconnect",
    async ({ fixture }) => {
      const conversation = await startGitHubWebhookTriggerConversation({
        fixture,
      });

      try {
        const unsubscribeResult = await unsubscribeCodexThread({
          rpcClient: conversation.rpcClient,
          threadId: conversation.providerConversationId,
        });
        expect(["unsubscribed", "notLoaded"]).toContain(unsubscribeResult.status);
        await conversation.reconnectRpcClient();

        const followUpMarker = `mistle-system-webhook-followup-${randomUUID()}`;
        const followUp = await triggerGitHubWebhookTriggerFollowUp({
          fixture,
          conversation,
          followUpMarker,
        });

        expect(followUp.conversationId).toBe(conversation.conversationId);
        expect(followUp.providerConversationId).toBe(conversation.providerConversationId);
        expect(followUp.sandboxInstanceId).toBe(conversation.sandboxInstanceId);
        expect(
          hasPersistedUserMessageText({
            threadReadResult: conversation.initialThreadRead,
            expectedSubstring: followUp.expectedInputSubstring,
          }),
        ).toBe(false);

        await resumeCodexThread({
          rpcClient: conversation.rpcClient,
          threadId: conversation.providerConversationId,
        });

        const resumedThread = await waitForCodexPersistedUserMessageText({
          rpcClient: conversation.rpcClient,
          threadId: conversation.providerConversationId,
          expectedSubstring: followUp.expectedInputSubstring,
          timeoutMs: ThreadReadTimeoutMs,
        });

        expect(resumedThread.threadId).toBe(conversation.providerConversationId);
      } finally {
        await conversation.cleanup();
      }
    },
    TestTimeoutMs,
  );
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPersistedUserMessageText(input: {
  threadReadResult: unknown;
  expectedSubstring: string;
}): boolean {
  if (!isRecord(input.threadReadResult)) {
    throw new Error("thread/read result must be an object.");
  }

  const turns = input.threadReadResult.turns;
  if (!Array.isArray(turns)) {
    throw new Error("thread/read result.turns must be an array.");
  }

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (!isRecord(turn) || !Array.isArray(turn.items)) {
      continue;
    }

    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (!isRecord(item) || item.type !== "userMessage" || !Array.isArray(item.content)) {
        continue;
      }

      for (const contentItem of item.content) {
        if (!isRecord(contentItem)) {
          continue;
        }

        if (contentItem.type !== "text" || typeof contentItem.text !== "string") {
          continue;
        }

        if (contentItem.text.includes(input.expectedSubstring)) {
          return true;
        }
      }
    }
  }

  return false;
}

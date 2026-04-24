/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { randomUUID } from "node:crypto";

import {
  readCodexThread,
  resumeCodexThread,
  unsubscribeCodexThread,
} from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { describe, expect } from "vitest";

import {
  hasRequiredGitHubWebhookAutomationEnv,
  startGitHubWebhookAutomationConversation,
  TestTimeoutMs,
  ThreadReadTimeoutMs,
  triggerGitHubWebhookAutomationFollowUp,
  waitForCodexPersistedUserMessageText,
  waitForCondition,
} from "./helpers/github-webhook-automation.js";
import { it } from "./system-test-context.js";

const describeIf = hasRequiredGitHubWebhookAutomationEnv() ? describe : describe.skip;

function readThreadStatusType(response: unknown): string | null {
  if (typeof response !== "object" || response === null || !("thread" in response)) {
    return null;
  }

  const thread = response.thread;
  if (typeof thread !== "object" || thread === null || !("status" in thread)) {
    return null;
  }

  const status = thread.status;
  if (typeof status !== "object" || status === null || !("type" in status)) {
    return null;
  }

  return typeof status.type === "string" ? status.type : null;
}

describeIf("system GitHub webhook automation thread resume", () => {
  it(
    "resumes an unloaded Codex thread before delivering a follow-up webhook event",
    async ({ fixture }) => {
      const conversation = await startGitHubWebhookAutomationConversation({
        fixture,
      });

      try {
        const initialTurnCount = conversation.initialThreadRead.turns.length;

        await unsubscribeCodexThread({
          rpcClient: conversation.rpcClient,
          threadId: conversation.providerConversationId,
        });
        await conversation.reconnectRpcClient();

        await waitForCondition({
          description: `Codex thread '${conversation.providerConversationId}' to become notLoaded`,
          timeoutMs: ThreadReadTimeoutMs,
          evaluate: async () => {
            const threadRead = await readCodexThread({
              rpcClient: conversation.rpcClient,
              threadId: conversation.providerConversationId,
            });

            return readThreadStatusType(threadRead.response) === "notLoaded" ? threadRead : null;
          },
        });

        const followUpMarker = `mistle-system-webhook-followup-${randomUUID()}`;
        const followUp = await triggerGitHubWebhookAutomationFollowUp({
          fixture,
          conversation,
          followUpMarker,
        });

        expect(followUp.conversationId).toBe(conversation.conversationId);
        expect(followUp.providerConversationId).toBe(conversation.providerConversationId);
        expect(followUp.sandboxInstanceId).toBe(conversation.sandboxInstanceId);

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
        expect(resumedThread.turns.length).toBeGreaterThan(initialTurnCount);
      } finally {
        await conversation.cleanup();
      }
    },
    TestTimeoutMs,
  );
});

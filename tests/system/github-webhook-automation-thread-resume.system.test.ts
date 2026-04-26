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
  hasRequiredGitHubWebhookAutomationEnv,
  startGitHubWebhookAutomationConversation,
  TestTimeoutMs,
  ThreadReadTimeoutMs,
  triggerGitHubWebhookAutomationFollowUp,
  waitForCodexPersistedUserMessageText,
} from "./helpers/github-webhook-automation.js";
import { it } from "./system-test-context.js";

const describeIf = hasRequiredGitHubWebhookAutomationEnv() ? describe : describe.skip;

describeIf("system GitHub webhook automation thread resume", () => {
  it(
    "reuses the same Codex thread after client unsubscribe and reconnect",
    async ({ fixture }) => {
      const conversation = await startGitHubWebhookAutomationConversation({
        fixture,
      });

      try {
        const initialTurnCount = conversation.initialThreadRead.turns.length;

        const unsubscribeResult = await unsubscribeCodexThread({
          rpcClient: conversation.rpcClient,
          threadId: conversation.providerConversationId,
        });
        expect(["unsubscribed", "notLoaded"]).toContain(unsubscribeResult.status);
        await conversation.reconnectRpcClient();

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

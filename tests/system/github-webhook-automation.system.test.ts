/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { describe, expect } from "vitest";

import {
  hasRequiredGitHubWebhookAutomationEnv,
  startGitHubWebhookAutomationConversation,
  TestTimeoutMs,
} from "./helpers/github-webhook-automation.js";
import { it } from "./system-test-context.js";

const describeIf = hasRequiredGitHubWebhookAutomationEnv() ? describe : describe.skip;

describeIf("system GitHub webhook automation", () => {
  it(
    "routes a real GitHub issue comment webhook into an automation conversation thread",
    async ({ fixture }) => {
      const conversation = await startGitHubWebhookAutomationConversation({
        fixture,
      });

      try {
        expect(conversation.initialThreadRead.threadId).toBe(conversation.providerConversationId);
      } finally {
        await conversation.cleanup();
      }
    },
    TestTimeoutMs,
  );
});

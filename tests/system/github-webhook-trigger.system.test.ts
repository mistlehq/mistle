/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { describe, expect } from "vitest";

import {
  hasRequiredGitHubWebhookTriggerEnv,
  startGitHubWebhookTriggerConversation,
  TestTimeoutMs,
} from "./helpers/github-webhook-trigger.js";
import { it } from "./system-test-context.js";

const describeIf = hasRequiredGitHubWebhookTriggerEnv() ? describe : describe.skip;

describeIf("system GitHub webhook trigger", () => {
  it(
    "routes a real GitHub issue comment webhook into a trigger conversation thread",
    async ({ fixture }) => {
      const conversation = await startGitHubWebhookTriggerConversation({
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

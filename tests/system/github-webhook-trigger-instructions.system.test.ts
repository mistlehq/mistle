/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { randomUUID } from "node:crypto";

import { describe, expect } from "vitest";

import {
  hasRequiredGitHubWebhookTriggerEnv,
  startGitHubWebhookTriggerConversation,
  TestTimeoutMs,
} from "./helpers/github-webhook-trigger.js";
import { it } from "./system-test-context.js";

const describeIf = hasRequiredGitHubWebhookTriggerEnv() ? describe : describe.skip;

describeIf("system GitHub webhook trigger instructions", () => {
  it(
    "applies trigger-specific instructions to the initial Codex turn",
    async ({ fixture }) => {
      const replyMarker = `trigger-instructions-${randomUUID()}`;
      const conversation = await startGitHubWebhookTriggerConversation({
        fixture,
        triggerInstructions: [
          `Include the exact marker '${replyMarker}' in your first assistant response.`,
          "Keep the rest of the response brief.",
        ].join(" "),
      });

      try {
        expect(conversation.initialThreadRead.threadId).toBe(conversation.providerConversationId);
        expect(conversation.triggerInstructionsSnapshot).toContain(replyMarker);
      } finally {
        await conversation.cleanup();
      }
    },
    TestTimeoutMs,
  );
});

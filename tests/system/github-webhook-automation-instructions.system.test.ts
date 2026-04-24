/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { randomUUID } from "node:crypto";

import { describe, expect } from "vitest";

import {
  hasRequiredGitHubWebhookAutomationEnv,
  startGitHubWebhookAutomationConversation,
  TestTimeoutMs,
} from "./helpers/github-webhook-automation.js";
import { it } from "./system-test-context.js";

const describeIf = hasRequiredGitHubWebhookAutomationEnv() ? describe : describe.skip;

describeIf("system GitHub webhook automation instructions", () => {
  it(
    "applies automation-specific instructions to the initial Codex turn",
    async ({ fixture }) => {
      const replyMarker = `automation-instructions-${randomUUID()}`;
      const conversation = await startGitHubWebhookAutomationConversation({
        fixture,
        automationInstructions: [
          `Include the exact marker '${replyMarker}' in your first assistant response.`,
          "Keep the rest of the response brief.",
        ].join(" "),
      });

      try {
        expect(conversation.initialThreadRead.threadId).toBe(conversation.providerConversationId);
        expect(conversation.automationInstructionsSnapshot).toContain(replyMarker);
      } finally {
        await conversation.cleanup();
      }
    },
    TestTimeoutMs,
  );
});

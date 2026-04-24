/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { randomUUID } from "node:crypto";

import {
  buildCodexTurnInputItems,
  startCodexTurn,
} from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { describe, expect } from "vitest";

import {
  AgentReplyTimeoutMs,
  createCodexTurnObserver,
  hasRequiredGitHubWebhookAutomationEnv,
  startGitHubWebhookAutomationConversation,
  TestTimeoutMs,
  waitForCondition,
  waitForGitHubIssueComment,
} from "./helpers/github-webhook-automation.js";
import { it } from "./system-test-context.js";

const describeIf = hasRequiredGitHubWebhookAutomationEnv() ? describe : describe.skip;

describeIf("system GitHub session link footer", () => {
  it(
    "appends the session link footer when the automation conversation replies through gh issue comment",
    async ({ fixture }) => {
      const conversation = await startGitHubWebhookAutomationConversation({
        fixture,
      });

      try {
        const agentReplyMarker = `mistle-system-agent-reply-${randomUUID()}`;
        const expectedSessionFooter = `\n\n---\n[🔗 View session](${conversation.buildExpectedSessionLinkUrl()})`;
        const ghCommentCommand = [
          "gh issue comment",
          String(conversation.issueNumber),
          `-R ${conversation.repository.owner}/${conversation.repository.repo}`,
          `--body $'${agentReplyMarker}\\nAutomated system test reply.'`,
        ].join(" ");
        const turnObserver = createCodexTurnObserver({
          rpcClient: conversation.rpcClient,
        });

        try {
          const agentReplyTurn = await startCodexTurn({
            rpcClient: conversation.rpcClient,
            threadId: conversation.providerConversationId,
            input: buildCodexTurnInputItems({
              text: [
                "Run exactly one shell command with the gh CLI to post the reply on GitHub.",
                "Do not ask follow-up questions and do not use any command other than the one below.",
                `Run this exact command: ${ghCommentCommand}`,
                `Do not include this webhook marker anywhere: ${conversation.payloadMarker}`,
              ].join("\n"),
              attachments: [],
            }),
          });

          await waitForCondition({
            description: `Codex turn '${agentReplyTurn.turnId}' to execute gh issue comment`,
            timeoutMs: AgentReplyTimeoutMs,
            evaluate: async () => {
              return turnObserver.commandExecutions.some((commandExecution) =>
                commandExecution.command.includes("gh issue comment"),
              )
                ? true
                : null;
            },
          });

          const agentComment = await waitForGitHubIssueComment({
            owner: conversation.repository.owner,
            repo: conversation.repository.repo,
            issueNumber: conversation.issueNumber,
            token: conversation.githubToken,
            expectedSubstring: agentReplyMarker,
            timeoutMs: AgentReplyTimeoutMs,
          });
          expect(agentComment.body).toContain(agentReplyMarker);
          expect(agentComment.body.endsWith(expectedSessionFooter)).toBe(true);
        } finally {
          turnObserver.dispose();
        }
      } finally {
        await conversation.cleanup();
      }
    },
    TestTimeoutMs,
  );
});

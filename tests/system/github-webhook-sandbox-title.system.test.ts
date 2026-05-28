/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  hasRequiredGitHubWebhookTriggerEnv,
  SandboxReadyTimeoutMs,
  startGitHubWebhookTriggerConversation,
  TestTimeoutMs,
  waitForCondition,
} from "./helpers/github-webhook-trigger.js";
import { it } from "./system-test-context.js";

const SandboxInstanceStatusResponseSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().min(1).nullable(),
  status: z.enum(SandboxInstanceStatuses),
  connectable: z.boolean(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  runtimeContext: z.unknown().nullable().optional(),
  triggerConversation: z.unknown().nullable().optional(),
});

const describeIf = hasRequiredGitHubWebhookTriggerEnv() ? describe : describe.skip;

describeIf("system GitHub webhook sandbox title seeding", () => {
  it(
    "seeds a non-empty sandbox title after a real GitHub webhook trigger delivery",
    async ({ fixture }) => {
      const conversation = await startGitHubWebhookTriggerConversation({
        fixture,
      });

      try {
        const sandboxInstance = await waitForCondition({
          description: "running sandbox instance with a seeded title",
          timeoutMs: SandboxReadyTimeoutMs,
          evaluate: async () => {
            const response = await fixture.request(
              `/v1/sandbox/instances/${encodeURIComponent(conversation.sandboxInstanceId)}`,
              {
                headers: {
                  cookie: conversation.sessionCookie,
                },
              },
            );

            const bodyText = await response.text().catch(() => "");
            if (response.status !== 200) {
              throw new Error(
                `sandbox instance status lookup failed with status ${String(response.status)}. Response body: ${bodyText}`,
              );
            }

            let parsed: unknown;
            try {
              parsed = JSON.parse(bodyText);
            } catch (error) {
              throw new Error(
                `sandbox instance status lookup returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
              );
            }

            const status = SandboxInstanceStatusResponseSchema.parse(parsed);
            if (status.status === "failed" || status.status === "stopped") {
              throw new Error(
                `Sandbox instance '${status.id}' entered terminal status '${status.status}': ${status.failureMessage ?? "no failure message"}`,
              );
            }

            return typeof status.title === "string" && status.title.trim().length > 0
              ? status
              : null;
          },
        });

        expect(sandboxInstance.id).toBe(conversation.sandboxInstanceId);
        expect(sandboxInstance.title).not.toBeNull();
        expect(sandboxInstance.title?.trim().length).toBeGreaterThan(0);
      } finally {
        await conversation.cleanup();
      }
    },
    TestTimeoutMs,
  );
});

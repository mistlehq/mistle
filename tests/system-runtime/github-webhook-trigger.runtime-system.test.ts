/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { createSystemTest, type RuntimeSystemTestEnvironment } from "@mistle/test-harness/system";
import { describe, expect } from "vitest";

import {
  hasRequiredGitHubWebhookTriggerEnv,
  startGitHubWebhookTriggerConversation,
  TestTimeoutMs,
} from "../system/helpers/github-webhook-trigger.js";
import { createRuntimeGitHubWebhookTriggerFixture } from "./helpers/runtime-github-webhook-trigger.js";

const dockerIt = createSystemTest({
  extraInfra: ["mailpit"],
  sandbox: {
    provider: "docker",
  },
  publicAccess: {
    provider: "cloudflare",
    services: ["control-plane-api"],
  },
});

const e2bIt = createSystemTest({
  extraInfra: ["mailpit"],
  sandbox: {
    provider: "e2b",
  },
  publicAccess: {
    provider: "cloudflare",
    services: ["control-plane-api", "data-plane-gateway"],
  },
});

const describeIf = hasRequiredGitHubWebhookTriggerEnv() ? describe : describe.skip;

describeIf("runtime system GitHub webhook trigger", () => {
  dockerIt(
    "routes a real GitHub issue comment webhook into a sandbox-backed Codex thread [docker]",
    runGitHubWebhookTriggerScenario,
    TestTimeoutMs,
  );

  e2bIt(
    "routes a real GitHub issue comment webhook into a sandbox-backed Codex thread [e2b]",
    runGitHubWebhookTriggerScenario,
    TestTimeoutMs,
  );
});

async function runGitHubWebhookTriggerScenario({
  system,
}: {
  system: RuntimeSystemTestEnvironment;
}): Promise<void> {
  const conversation = await startGitHubWebhookTriggerConversation({
    fixture: createRuntimeGitHubWebhookTriggerFixture(system),
  });

  try {
    expect(conversation.initialThreadRead.threadId).toBe(conversation.providerConversationId);
  } finally {
    await conversation.cleanup();
  }
}

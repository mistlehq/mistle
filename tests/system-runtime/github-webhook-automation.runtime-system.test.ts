/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { createSystemTest, type RuntimeSystemTestEnvironment } from "@mistle/test-harness/system";
import { describe, expect } from "vitest";

import {
  hasRequiredGitHubWebhookAutomationEnv,
  startGitHubWebhookAutomationConversation,
  TestTimeoutMs,
} from "../system/helpers/github-webhook-automation.js";
import { createRuntimeGitHubWebhookAutomationFixture } from "./helpers/runtime-github-webhook-automation.js";

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

const describeIf = hasRequiredGitHubWebhookAutomationEnv() ? describe : describe.skip;

describeIf("runtime system GitHub webhook automation", () => {
  dockerIt(
    "routes a real GitHub issue comment webhook into a sandbox-backed Codex thread [docker]",
    runGitHubWebhookAutomationScenario,
    TestTimeoutMs,
  );

  e2bIt(
    "routes a real GitHub issue comment webhook into a sandbox-backed Codex thread [e2b]",
    runGitHubWebhookAutomationScenario,
    TestTimeoutMs,
  );
});

async function runGitHubWebhookAutomationScenario({
  system,
}: {
  system: RuntimeSystemTestEnvironment;
}): Promise<void> {
  const conversation = await startGitHubWebhookAutomationConversation({
    fixture: createRuntimeGitHubWebhookAutomationFixture(system),
  });

  try {
    expect(conversation.initialThreadRead.threadId).toBe(conversation.providerConversationId);
  } finally {
    await conversation.cleanup();
  }
}

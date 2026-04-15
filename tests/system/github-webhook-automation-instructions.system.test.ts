/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect } from "vitest";

import {
  startCloudflaredTunnel,
  type StartedCloudflaredTunnel,
} from "./helpers/cloudflared-tunnel.js";
import {
  hasRequiredGitHubWebhookAutomationEnv,
  requireGitHubWebhookAutomationEnv,
  resolveControlPlaneApiLocalPort,
  startGitHubWebhookAutomationConversation,
  TestTimeoutMs,
  TunnelStartupTimeoutMs,
} from "./helpers/github-webhook-automation.js";
import { it, readSystemTestContext } from "./system-test-context.js";

const describeIf = hasRequiredGitHubWebhookAutomationEnv() ? describe : describe.skip;

describeIf("system GitHub webhook automation instructions", () => {
  let tunnel: StartedCloudflaredTunnel | null = null;

  beforeAll(async () => {
    const systemTestContext = await readSystemTestContext();
    tunnel = await startCloudflaredTunnel({
      tunnelToken: requireGitHubWebhookAutomationEnv("CLOUDFLARE_TUNNEL_TOKEN"),
      publicHostname: requireGitHubWebhookAutomationEnv("CONTROL_PLANE_API_TUNNEL_HOSTNAME"),
      targetLocalPort: resolveControlPlaneApiLocalPort(systemTestContext.controlPlaneApiBaseUrl),
      startupTimeoutMs: TunnelStartupTimeoutMs,
    });
  }, TunnelStartupTimeoutMs + 30_000);

  afterAll(async () => {
    if (tunnel !== null) {
      await tunnel.stop();
    }
  });

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

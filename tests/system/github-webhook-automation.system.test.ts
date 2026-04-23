/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

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

describeIf("system GitHub webhook automation", () => {
  let tunnel: StartedCloudflaredTunnel | null = null;

  beforeAll(async () => {
    const systemTestContext = await readSystemTestContext();
    tunnel = await startCloudflaredTunnel({
      tunnelId: requireGitHubWebhookAutomationEnv("CLOUDFLARE_TUNNEL_ID"),
      tunnelCredentialsJson: requireGitHubWebhookAutomationEnv(
        "CLOUDFLARE_TUNNEL_CREDENTIALS_JSON",
      ),
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

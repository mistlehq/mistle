import { describe, expect, it } from "vitest";

import { buildIntegrationWebhookCallbackUrl } from "./webhook-callback-url.server.js";

describe("buildIntegrationWebhookCallbackUrl", () => {
  it("builds a source-keyed control-plane callback URL", () => {
    expect(
      buildIntegrationWebhookCallbackUrl({
        controlPlaneBaseUrl: "https://control-plane.mistle.test",
        targetKey: "github-cloud",
        endpointKey: "ep_github_123",
      }),
    ).toBe("https://control-plane.mistle.test/p/integration/webhooks/github-cloud/ep_github_123");
  });

  it("preserves configured control-plane base path prefixes", () => {
    expect(
      buildIntegrationWebhookCallbackUrl({
        controlPlaneBaseUrl: "https://control-plane.mistle.test/base?x=1#frag",
        targetKey: "slack-default",
        endpointKey: "ep_slack_123",
      }),
    ).toBe(
      "https://control-plane.mistle.test/base/p/integration/webhooks/slack-default/ep_slack_123",
    );
  });

  it("encodes source identifiers as path segments", () => {
    expect(
      buildIntegrationWebhookCallbackUrl({
        controlPlaneBaseUrl: "https://control-plane.mistle.test",
        targetKey: "jira/default",
        endpointKey: "ep/jira",
      }),
    ).toBe("https://control-plane.mistle.test/p/integration/webhooks/jira%2Fdefault/ep%2Fjira");
  });
});

import { describe, expect, it } from "vitest";

import { buildSlackWebhookCallbackUrl } from "./webhook-source.server.js";

describe("slack webhook source helpers", () => {
  it("builds a source-keyed control-plane callback URL", () => {
    expect(
      buildSlackWebhookCallbackUrl({
        controlPlaneBaseUrl: "https://control-plane.mistle.test",
        targetKey: "slack-default",
        endpointKey: "ep_slack_123",
      }),
    ).toBe("https://control-plane.mistle.test/p/integration/webhooks/slack-default/ep_slack_123");
  });
});

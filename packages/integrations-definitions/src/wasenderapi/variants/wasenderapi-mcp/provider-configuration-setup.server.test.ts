import type { IntegrationProviderConfigurationSetupCompleteInput } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import type { WasenderApiConnectionConfig } from "./auth.js";
import { WasenderApiProviderConfigurationSetupCapability } from "./provider-configuration-setup.server.js";
import type { WasenderApiTargetConfig } from "./target-config-schema.js";

function resolveWasenderApiSetupFlow() {
  const flow = WasenderApiProviderConfigurationSetupCapability.flows.find(
    (candidate) =>
      candidate.methodId === "api-key" && candidate.routeSegment === "provider-configuration",
  );
  if (flow === undefined) {
    throw new Error("Expected WasenderAPI provider configuration setup flow.");
  }

  return flow;
}

const CompleteInput: IntegrationProviderConfigurationSetupCompleteInput<
  WasenderApiTargetConfig,
  Record<string, string>,
  WasenderApiConnectionConfig
> = {
  connection: {
    id: "icn_wasenderapi",
    status: "active",
    config: {
      connection_method: "api-key",
    },
  },
  connectionSecrets: {
    personalAccessToken: "wasenderapi-personal-access-token",
    webhookSecret: "wasenderapi-webhook-secret",
  },
  controlPlaneBaseUrl: "https://control-plane.example.com",
  target: {
    familyId: "wasenderapi",
    variantId: "wasenderapi-mcp",
    enabled: true,
    config: {},
    secrets: {},
  },
  webhookCallbackUrl:
    "https://control-plane.example.com/p/integration/webhooks/wasenderapi/epk_wasenderapi",
};

describe("WasenderAPI provider configuration setup", () => {
  it("completes manual setup when the callback URL and required secrets are present", () => {
    expect(() => resolveWasenderApiSetupFlow().complete(CompleteInput)).not.toThrow();
  });

  it("requires a webhook callback URL", () => {
    expect(() =>
      resolveWasenderApiSetupFlow().complete({
        ...CompleteInput,
        webhookCallbackUrl: undefined,
      }),
    ).toThrow(
      "WasenderAPI provider configuration setup for connection 'icn_wasenderapi' requires a webhook callback URL.",
    );
  });

  it("requires a personal access token", () => {
    expect(() =>
      resolveWasenderApiSetupFlow().complete({
        ...CompleteInput,
        connectionSecrets: {
          webhookSecret: "wasenderapi-webhook-secret",
        },
      }),
    ).toThrow("WasenderAPI provider configuration setup requires a personal access token.");
  });

  it("requires a webhook secret", () => {
    expect(() =>
      resolveWasenderApiSetupFlow().complete({
        ...CompleteInput,
        connectionSecrets: {
          personalAccessToken: "wasenderapi-personal-access-token",
        },
      }),
    ).toThrow("WasenderAPI provider configuration setup requires a webhook secret.");
  });
});

import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { describe, expect, it } from "vitest";

import { SeedDefaultIntegrationTargetsForTests } from "./seed-default-targets.js";

describe("seed-default-targets", () => {
  it("seeds all known variants and soft-disables GitHub targets when app slugs are missing", () => {
    const targets = SeedDefaultIntegrationTargetsForTests.buildSeedIntegrationTargets(undefined);

    expect(targets).toEqual([
      {
        targetKey: "openai-default",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com",
          binding_capabilities: createOpenAiRawBindingCapabilities(),
        },
      },
      {
        targetKey: "github-cloud",
        familyId: "github",
        variantId: "github-cloud",
        enabled: false,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      },
      {
        targetKey: "github-enterprise-server",
        familyId: "github",
        variantId: "github-enterprise-server",
        enabled: false,
        config: {
          api_base_url: "https://github.example.com/api/v3",
          web_base_url: "https://github.example.com",
        },
      },
    ]);
  });

  it("enables GitHub cloud and enterprise when app slugs are configured", () => {
    const targets = SeedDefaultIntegrationTargetsForTests.buildSeedIntegrationTargets({
      github: {
        appSlug: "mistle-github-app",
        appId: "123456",
        clientId: "github-client-id",
        apiBaseUrl: "https://api.github.com",
        webBaseUrl: "https://github.com",
      },
      githubEnterprise: {
        appSlug: "mistle-ghe-app",
        appId: "7890",
        clientId: "github-enterprise-client-id",
        apiBaseUrl: "https://ghe.example.com/api/v3",
        webBaseUrl: "https://ghe.example.com",
      },
      openai: {
        apiBaseUrl: "https://api.openai.com",
      },
    });

    expect(targets).toEqual([
      {
        targetKey: "openai-default",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com",
          binding_capabilities: createOpenAiRawBindingCapabilities(),
        },
      },
      {
        targetKey: "github-cloud",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
          app_slug: "mistle-github-app",
          app_id: "123456",
          client_id: "github-client-id",
        },
      },
      {
        targetKey: "github-enterprise-server",
        familyId: "github",
        variantId: "github-enterprise-server",
        enabled: true,
        config: {
          api_base_url: "https://ghe.example.com/api/v3",
          web_base_url: "https://ghe.example.com",
          app_slug: "mistle-ghe-app",
          app_id: "7890",
          client_id: "github-enterprise-client-id",
        },
      },
    ]);
  });
});

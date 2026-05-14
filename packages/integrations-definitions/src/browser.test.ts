import { describe, expect, it } from "vitest";

import {
  AwsBrowserDefinition,
  createBrowserDefinitionsBundle,
  DatadogBrowserDefinition,
  E2BSandboxRuntimeBrowserDefinition,
  GitHubCloudBrowserDefinition,
  JiraBrowserDefinition,
  SentryBrowserDefinition,
  SignozBrowserDefinition,
  SlackBrowserDefinition,
} from "./browser.js";

describe("browser definitions", () => {
  it("keeps jira browser definitions free of server-only webhook handlers", () => {
    expect(JiraBrowserDefinition.webhookHandler).toBeUndefined();
    expect(JiraBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("keeps github browser definitions free of server-only webhook hooks", () => {
    expect(GitHubCloudBrowserDefinition.redirectHandler).toBeUndefined();
    expect(GitHubCloudBrowserDefinition.webhookHandler).toBeUndefined();
    expect(GitHubCloudBrowserDefinition.webhookSource).toBeUndefined();
    expect(GitHubCloudBrowserDefinition.identityLinking).toEqual({
      eligibleConnectionMethodIds: ["github-app-installation"],
    });
  });

  it("registers jira in the browser-safe definitions bundle", () => {
    const definitions = createBrowserDefinitionsBundle().integrationRegistry.listDefinitions();

    expect(
      definitions.some(
        (definition) =>
          definition.familyId === JiraBrowserDefinition.familyId &&
          definition.variantId === JiraBrowserDefinition.variantId,
      ),
    ).toBe(true);
  });

  it("registers aws in the browser-safe definitions bundle", () => {
    const definitions = createBrowserDefinitionsBundle().integrationRegistry.listDefinitions();

    expect(
      definitions.some(
        (definition) =>
          definition.familyId === AwsBrowserDefinition.familyId &&
          definition.variantId === AwsBrowserDefinition.variantId,
      ),
    ).toBe(true);
    expect(AwsBrowserDefinition.credentialResolvers).toBeUndefined();
    expect(AwsBrowserDefinition.webhookHandler).toBeUndefined();
    expect(AwsBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("keeps Datadog browser definitions free of server-only hooks", () => {
    expect(DatadogBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
    expect(DatadogBrowserDefinition.webhookHandler).toBeUndefined();
    expect(DatadogBrowserDefinition.webhookSource).toBeUndefined();
  });

  it("keeps slack browser definitions free of server-only webhook hooks", () => {
    expect(SlackBrowserDefinition.webhookHandler).toBeUndefined();
    expect(SlackBrowserDefinition.webhookSource).toBeUndefined();
    expect(SlackBrowserDefinition.identityLinking).toEqual({
      eligibleConnectionMethodIds: ["slack-bot-token"],
    });
  });

  it("keeps signoz browser definitions free of server-only OAuth handlers", () => {
    expect(SignozBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
  });

  it("keeps sentry browser definitions free of server-only OAuth handlers", () => {
    expect(SentryBrowserDefinition.oauth2AuthorizationCode).toBeUndefined();
  });

  it("registers E2B sandbox runtime in the browser-safe definitions bundle", () => {
    const definition = createBrowserDefinitionsBundle().integrationRegistry.getDefinition({
      familyId: E2BSandboxRuntimeBrowserDefinition.familyId,
      variantId: E2BSandboxRuntimeBrowserDefinition.variantId,
    });

    expect(definition).toMatchObject({
      familyId: "e2b",
      variantId: "e2b-default",
      kind: "sandbox",
      sandboxRuntime: {
        providerId: "e2b",
      },
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  createBrowserDefinitionsBundle,
  GitHubCloudBrowserDefinition,
  JiraBrowserDefinition,
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

  it("keeps slack browser definitions free of server-only webhook hooks", () => {
    expect(SlackBrowserDefinition.webhookHandler).toBeUndefined();
    expect(SlackBrowserDefinition.webhookSource).toBeUndefined();
  });
});

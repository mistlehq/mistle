import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { GitHubCloudBindingConfigSchema } from "../variants/github-cloud/binding-config-schema.js";
import { GitHubConnectionConfigSchema } from "./auth.js";
import { resolveGitHubBindingConfigForm } from "./binding-config-form.js";
import { GitHubTargetConfigSchema } from "./target-config-schema.js";

describe("github binding config forms", () => {
  it("resolves the repository resource selector widget from connection context", () => {
    const targetConfig = GitHubTargetConfigSchema.parse({
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    });
    const connectionConfig = GitHubConnectionConfigSchema.parse({
      connection_method: "api-key",
    });

    const resolvedForm = resolveIntegrationForm({
      schema: GitHubCloudBindingConfigSchema,
      form: resolveGitHubBindingConfigForm,
      context: {
        familyId: "github",
        variantId: "github-cloud",
        kind: "git",
        target: {
          rawConfig: {
            api_base_url: "https://api.github.com",
            web_base_url: "https://github.com",
          },
          config: targetConfig,
        },
        connection: {
          id: "icn_github_form_test_001",
          rawConfig: {
            connection_method: "api-key",
          },
          config: connectionConfig,
          resources: [
            {
              kind: "repository",
              selectionMode: "multi",
              count: 12,
              syncState: "ready",
              lastSyncedAt: "2026-03-09T00:00:00.000Z",
            },
          ],
        },
      },
    });

    expect(resolvedForm.uiSchema).toEqual({
      repositories: {
        "ui:widget": "integration-resource-string-array",
        "ui:options": {
          connectionId: "icn_github_form_test_001",
          kind: "repository",
          title: "Repositories",
          searchPlaceholder: "Search repositories",
          emptyMessage: "No repositories available for this connection.",
          refreshLabel: "Refresh repositories",
          resourceSummary: {
            kind: "repository",
            selectionMode: "multi",
            count: 12,
            syncState: "ready",
            lastSyncedAt: "2026-03-09T00:00:00.000Z",
          },
        },
      },
    });
  });

  it("requires connection context to resolve the repository resource selector widget", () => {
    expect(() =>
      resolveIntegrationForm({
        schema: GitHubCloudBindingConfigSchema,
        form: resolveGitHubBindingConfigForm,
        context: {
          familyId: "github",
          variantId: "github-cloud",
          kind: "git",
        },
      }),
    ).toThrow("GitHub binding form requires connection context.");
  });
});

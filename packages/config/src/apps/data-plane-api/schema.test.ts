import { describe, expect, it } from "vitest";

import {
  DataPlaneApiSandboxConfigSchema,
  getDataPlaneApiSandboxProviderValidationIssue,
} from "./schema.js";

describe("DataPlaneApiSandboxConfigSchema", () => {
  it("defaults the E2B domain to the hosted cloud domain", () => {
    const parsed = DataPlaneApiSandboxConfigSchema.parse({
      e2b: {
        apiKey: "test-api-key",
      },
    });

    expect(parsed).toEqual({
      e2b: {
        apiKey: "test-api-key",
        domain: "e2b.app",
      },
    });
  });
});

describe("getDataPlaneApiSandboxProviderValidationIssue", () => {
  it("requires docker settings when the global provider is docker", () => {
    const issue = getDataPlaneApiSandboxProviderValidationIssue({
      globalSandboxProvider: "docker",
      appSandbox: {},
    });

    expect(issue).toEqual({
      path: ["sandbox", "docker"],
      message:
        "apps.data_plane_api.sandbox.docker is required when global.sandbox.provider is 'docker'.",
    });
  });
});

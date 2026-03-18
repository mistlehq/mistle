import { describe, expect, it } from "vitest";

import { aggregateArtifactEnvironment } from "./artifact-environment.js";

describe("aggregateArtifactEnvironment", () => {
  it("returns undefined when no artifact env entries are present", () => {
    expect(
      aggregateArtifactEnvironment([
        {
          artifactKey: "artifact_without_env",
          name: "Artifact without env",
          env: {},
          lifecycle: {
            install: [],
            remove: [],
          },
        },
      ]),
    ).toBeUndefined();
  });

  it("aggregates env entries across artifacts", () => {
    expect(
      aggregateArtifactEnvironment([
        {
          artifactKey: "gh-cli",
          name: "GitHub CLI",
          env: {
            GH_TOKEN: "dummy-token",
          },
          lifecycle: {
            install: [],
            remove: [],
          },
        },
        {
          artifactKey: "linear-mcp",
          name: "Linear MCP",
          env: {
            LINEAR_API_KEY: "dummy-linear-token",
          },
          lifecycle: {
            install: [],
            remove: [],
          },
        },
      ]),
    ).toEqual({
      GH_TOKEN: "dummy-token",
      LINEAR_API_KEY: "dummy-linear-token",
    });
  });

  it("allows duplicate env keys when values are identical", () => {
    expect(
      aggregateArtifactEnvironment([
        {
          artifactKey: "artifact_a",
          name: "Artifact A",
          env: {
            SHARED_KEY: "shared-value",
          },
          lifecycle: {
            install: [],
            remove: [],
          },
        },
        {
          artifactKey: "artifact_b",
          name: "Artifact B",
          env: {
            SHARED_KEY: "shared-value",
          },
          lifecycle: {
            install: [],
            remove: [],
          },
        },
      ]),
    ).toEqual({
      SHARED_KEY: "shared-value",
    });
  });

  it("rejects duplicate env keys with different values", () => {
    expect(() =>
      aggregateArtifactEnvironment([
        {
          artifactKey: "artifact_a",
          name: "Artifact A",
          env: {
            SHARED_KEY: "value-a",
          },
          lifecycle: {
            install: [],
            remove: [],
          },
        },
        {
          artifactKey: "artifact_b",
          name: "Artifact B",
          env: {
            SHARED_KEY: "value-b",
          },
          lifecycle: {
            install: [],
            remove: [],
          },
        },
      ]),
    ).toThrow(/SHARED_KEY/);
  });
});

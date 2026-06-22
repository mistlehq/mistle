import { describe, expect, it } from "vitest";

import { parseCliArguments } from "./build-provider-image.ts";

describe("parseCliArguments", () => {
  it("uses the sandbox base repository for the default docker target", () => {
    const argumentsList = parseCliArguments(["--provider", "docker", "--tag", "dev-sandbox-base"]);

    expect(argumentsList.repository).toBe("ghcr.io/mistlehq/sandbox-base");
    expect(argumentsList.repositoryProvided).toBe(false);
  });

  it("uses the Designer base repository for the Designer docker target", () => {
    const argumentsList = parseCliArguments([
      "--provider",
      "docker",
      "--target",
      "sandbox-designer-base",
      "--tag",
      "dev-designer-base",
    ]);

    expect(argumentsList.repository).toBe("ghcr.io/mistlehq/designer-base");
    expect(argumentsList.repositoryProvided).toBe(false);
  });

  it("keeps an explicit repository for the Designer docker target", () => {
    const argumentsList = parseCliArguments([
      "--provider",
      "docker",
      "--target",
      "sandbox-designer-base",
      "--repository",
      "registry.example.test/custom/designer-base",
      "--tag",
      "dev-designer-base",
    ]);

    expect(argumentsList.repository).toBe("registry.example.test/custom/designer-base");
    expect(argumentsList.repositoryProvided).toBe(true);
  });
});

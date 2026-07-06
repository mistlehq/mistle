import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseCliArguments, validateTensorlakeCliContract } from "./build-provider-image.ts";

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

  it("keeps the public Tensorlake push script on the import-only CLI contract", () => {
    const packageJson = readFileSync("package.json", "utf8");
    const match = /"dev:sandbox-base:push:tensorlake": "([^"]+)"/u.exec(packageJson);
    if (match === null) {
      throw new Error("package.json must define dev:sandbox-base:push:tensorlake.");
    }

    expect(match[1]).toBe(
      "pnpm --filter @mistle/sandbox... build && pnpm sandbox-base:build --provider tensorlake",
    );
  });

  it("publishes the Designer base image in the sandbox base workflow", () => {
    const workflow = readFileSync(".github/workflows/publish-sandbox-base.yml", "utf8");

    expect(workflow).toContain("DESIGNER_BASE_IMAGE_REPOSITORY: ghcr.io/mistlehq/designer-base");
    expect(workflow).toContain("--target sandbox-designer-base");
    expect(workflow).toContain("${DESIGNER_BASE_IMAGE_REPOSITORY}:${IMAGE_LATEST_TAG}");
  });

  it("includes the Designer base image in release publishing and promotion", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(workflow).toContain("DESIGNER_BASE_IMAGE_REPOSITORY: ghcr.io/mistlehq/designer-base");
    expect(workflow).toContain("--target sandbox-designer-base");
    expect(workflow).toContain('"component":"designer-base"');
    expect(workflow).toContain('repository = "ghcr.io/mistlehq/designer-base"');
  });

  it("accepts Tensorlake image import arguments without sandboxd build inputs", () => {
    const argumentsList = parseCliArguments([
      "--provider",
      "tensorlake",
      "--source-image-ref",
      "ghcr.io/mistlehq/sandbox-base:test",
      "--output-image-ref",
      "mistle-test",
    ]);

    expect(() => validateTensorlakeCliContract(argumentsList)).not.toThrow();
    expect(argumentsList.sandboxdSource).toBeUndefined();
  });

  it("rejects Tensorlake sandboxd build inputs", () => {
    const argumentsList = parseCliArguments([
      "--provider",
      "tensorlake",
      "--source-image-ref",
      "ghcr.io/mistlehq/sandbox-base:test",
      "--output-image-ref",
      "mistle-test",
      "--sandboxd-source",
      "local",
    ]);

    expect(() => validateTensorlakeCliContract(argumentsList)).toThrow(
      "--sandboxd-source is not supported when --provider is tensorlake",
    );
  });
});

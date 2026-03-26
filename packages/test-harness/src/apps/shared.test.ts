import { describe, expect, it } from "vitest";

import { createDockerBuildCommandArgs } from "./shared.js";

describe("createDockerBuildCommandArgs", () => {
  it("creates docker build args for a target image without build args", () => {
    expect(
      createDockerBuildCommandArgs({
        dockerfileRelativePath: "Dockerfile.test",
        dockerTarget: "data-plane-gateway-test-runtime",
        imageName: "mistle-test-target-123",
        buildArgs: undefined,
      }),
    ).toEqual([
      "build",
      "--pull=false",
      "--target",
      "data-plane-gateway-test-runtime",
      "-f",
      "Dockerfile.test",
      "-t",
      "mistle-test-target-123",
      ".",
    ]);
  });

  it("includes sorted build args before the docker target selection", () => {
    expect(
      createDockerBuildCommandArgs({
        dockerfileRelativePath: "Dockerfile.test",
        dockerTarget: "data-plane-api-test-runtime",
        imageName: "mistle-test-target-456",
        buildArgs: {
          ZED: "last",
          ALPHA: "first",
        },
      }),
    ).toEqual([
      "build",
      "--pull=false",
      "--build-arg",
      "ALPHA=first",
      "--build-arg",
      "ZED=last",
      "--target",
      "data-plane-api-test-runtime",
      "-f",
      "Dockerfile.test",
      "-t",
      "mistle-test-target-456",
      ".",
    ]);
  });
});

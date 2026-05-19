import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  findSandboxBaseEnvironmentDrift,
  findSandboxBaseInventorySpecDrift,
} from "./check-inventory-spec.ts";
import { SandboxBaseInventorySpec } from "./inventory-spec.ts";

const DockerfileUrl = new URL(`../../${SandboxBaseInventorySpec.dockerfilePath}`, import.meta.url);

describe("sandbox base inventory spec Dockerfile check", () => {
  it("accepts the current sandbox base Dockerfile", () => {
    const dockerfileText = readFileSync(DockerfileUrl, "utf8");

    expect(findSandboxBaseInventorySpecDrift(dockerfileText)).toEqual([]);
    expect(findSandboxBaseEnvironmentDrift(dockerfileText)).toEqual([]);
  });

  it("requires the sandbox base image to set the root home directory", () => {
    const dockerfileText = readFileSync(DockerfileUrl, "utf8").replace(
      /^\s+HOME=\/root \\\n/mu,
      "",
    );

    expect(findSandboxBaseEnvironmentDrift(dockerfileText)).toEqual([
      "expected environment variable HOME=/root in stage 'sandbox-base-common'",
    ]);
  });

  it("reports drift when a declared apt-backed command is removed", () => {
    const dockerfileText = readFileSync(DockerfileUrl, "utf8").replace(/^\s+ripgrep \\\n/mu, "");

    expect(findSandboxBaseInventorySpecDrift(dockerfileText)).toContain(
      "rg: expected apt package 'ripgrep' in stage 'sandbox-base-common'",
    );
  });
});

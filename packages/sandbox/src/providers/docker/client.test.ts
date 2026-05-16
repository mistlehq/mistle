import { describe, expect, it } from "vitest";

import { createDockerSandboxHostConfig } from "./client.js";

describe("createDockerSandboxHostConfig", () => {
  it("maps host.docker.internal to the Docker host gateway for sandbox containers", () => {
    expect(createDockerSandboxHostConfig({}).ExtraHosts).toEqual([
      "host.docker.internal:host-gateway",
    ]);
  });

  it("preserves the selected sandbox network while adding host gateway DNS", () => {
    expect(createDockerSandboxHostConfig({ networkName: "mistle-sandbox-test" })).toMatchObject({
      ExtraHosts: ["host.docker.internal:host-gateway"],
      NetworkMode: "mistle-sandbox-test",
    });
  });

  it("enables the sandbox container privileges required by systemd and transparent egress rules", () => {
    expect(createDockerSandboxHostConfig({})).toMatchObject({
      CapAdd: ["NET_ADMIN"],
      Privileged: true,
    });
  });
});

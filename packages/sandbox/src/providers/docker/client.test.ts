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

  it("adds NET_ADMIN without privileged mode when gateway proxy mode needs redirect rules", () => {
    expect(createDockerSandboxHostConfig({ netAdmin: true })).toMatchObject({
      CapAdd: ["NET_ADMIN"],
    });
    expect(createDockerSandboxHostConfig({ netAdmin: true }).Privileged).toBeUndefined();
  });
});

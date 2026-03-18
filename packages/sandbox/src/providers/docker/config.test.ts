import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { validateDockerSandboxConfig } from "./config.js";

describe("validateDockerSandboxConfig", () => {
  it("returns config when all required fields are non-empty", () => {
    const config = validateDockerSandboxConfig({
      socketPath: "/var/run/docker.sock",
      networkName: "mistle-sandbox-dev",
    });

    expect(config).toEqual({
      socketPath: "/var/run/docker.sock",
      networkName: "mistle-sandbox-dev",
    });
  });

  it("throws when socket path is empty", () => {
    expect(() =>
      validateDockerSandboxConfig({
        socketPath: "",
        networkName: "mistle-sandbox-dev",
      }),
    ).toThrow(ZodError);
  });

  it("throws when network name is empty", () => {
    expect(() =>
      validateDockerSandboxConfig({
        socketPath: "/var/run/docker.sock",
        networkName: "  ",
      }),
    ).toThrow(ZodError);
  });
});

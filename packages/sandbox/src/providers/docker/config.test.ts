import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { validateDockerSandboxConfig } from "./config.js";

describe("validateDockerSandboxConfig", () => {
  it("returns config when all required fields are non-empty", () => {
    const config = validateDockerSandboxConfig({
      socketPath: "/var/run/docker.sock",
      snapshotRepository: "localhost:5001/mistle/snapshots",
    });

    expect(config).toEqual({
      socketPath: "/var/run/docker.sock",
      snapshotRepository: "localhost:5001/mistle/snapshots",
    });
  });

  it("throws when socket path is empty", () => {
    expect(() =>
      validateDockerSandboxConfig({
        socketPath: "",
        snapshotRepository: "localhost:5001/mistle/snapshots",
      }),
    ).toThrowError(ZodError);
  });

  it("throws when snapshot repository is empty", () => {
    expect(() =>
      validateDockerSandboxConfig({
        socketPath: "/var/run/docker.sock",
        snapshotRepository: "  ",
      }),
    ).toThrowError(ZodError);
  });
});

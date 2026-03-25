import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "./errors.js";
import { createSandboxAdapter, createSandboxRuntimeControl } from "./factory.js";
import { SandboxProvider } from "./types.js";

describe("createSandboxAdapter", () => {
  it("creates a docker adapter when docker config is provided", () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: "/var/run/docker.sock",
      },
    });

    expect(typeof adapter.start).toBe("function");
    expect(typeof adapter.resume).toBe("function");
    expect(typeof adapter.stop).toBe("function");
    expect(typeof adapter.destroy).toBe("function");
  });

  it("throws when docker config is missing", () => {
    expect(() =>
      createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
      }),
    ).toThrow(SandboxConfigurationError);
  });
});

describe("createSandboxRuntimeControl", () => {
  it("creates a docker runtime control when docker config is provided", () => {
    const runtimeControl = createSandboxRuntimeControl({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: "/var/run/docker.sock",
      },
    });

    expect(typeof runtimeControl.applyStartup).toBe("function");
    expect(typeof runtimeControl.close).toBe("function");
  });

  it("throws when docker runtime control config is missing", () => {
    expect(() =>
      createSandboxRuntimeControl({
        provider: SandboxProvider.DOCKER,
      }),
    ).toThrow(SandboxConfigurationError);
  });
});

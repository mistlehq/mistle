import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "./errors.js";
import { createSandboxAdapter } from "./factory.js";
import { SandboxProvider } from "./types.js";

describe("createSandboxAdapter", () => {
  it("creates a modal adapter when modal config is provided", () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.MODAL,
      modal: {
        tokenId: "modal-token-id",
        tokenSecret: "modal-token-secret",
        appName: "mistle-sandbox-app",
      },
    });

    expect(typeof adapter.createVolume).toBe("function");
    expect(typeof adapter.deleteVolume).toBe("function");
    expect(typeof adapter.start).toBe("function");
    expect(typeof adapter.resume).toBe("function");
    expect(typeof adapter.stop).toBe("function");
    expect(typeof adapter.destroy).toBe("function");
  });

  it("throws when modal config is missing", () => {
    expect(() =>
      createSandboxAdapter({
        provider: SandboxProvider.MODAL,
      }),
    ).toThrow(SandboxConfigurationError);
  });

  it("creates a docker adapter when docker config is provided", () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: "/var/run/docker.sock",
      },
    });

    expect(typeof adapter.createVolume).toBe("function");
    expect(typeof adapter.deleteVolume).toBe("function");
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

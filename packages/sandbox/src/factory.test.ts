import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "./errors.js";
import { createSandboxAdapter, createSandboxRuntimeControl } from "./factory.js";
import { SandboxAttachedStorageBackends, SandboxProvider } from "./types.js";

describe("createSandboxAdapter", () => {
  it("creates a docker adapter when docker config is provided", () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: "/var/run/docker.sock",
      },
    });

    expect(typeof adapter.prepareStorageForStart).toBe("function");
    expect(typeof adapter.start).toBe("function");
    expect(typeof adapter.inspect).toBe("function");
    expect(typeof adapter.resume).toBe("function");
    expect(typeof adapter.attachStorage).toBe("function");
    expect(typeof adapter.cleanupStorage).toBe("function");
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

  it("creates an E2B adapter when E2B config is provided", () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.E2B,
      e2b: {
        apiKey: "test-api-key",
      },
    });

    expect(typeof adapter.prepareStorageForStart).toBe("function");
    expect(typeof adapter.start).toBe("function");
    expect(typeof adapter.inspect).toBe("function");
    expect(typeof adapter.resume).toBe("function");
    expect(typeof adapter.attachStorage).toBe("function");
    expect(typeof adapter.cleanupStorage).toBe("function");
    expect(typeof adapter.stop).toBe("function");
    expect(typeof adapter.destroy).toBe("function");
  });

  it("throws when E2B config is missing", () => {
    expect(() =>
      createSandboxAdapter({
        provider: SandboxProvider.E2B,
      }),
    ).toThrow(SandboxConfigurationError);
  });
});

describe("provider storage lifecycle no-op hooks", () => {
  it("keeps docker storage attach and cleanup as no-ops in this phase", async () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: "/var/run/docker.sock",
      },
    });

    await expect(
      adapter.prepareStorageForStart({
        sandboxInstanceId: "sbi_12345678901234567890123456",
      }),
    ).resolves.toEqual({});

    await expect(
      adapter.attachStorage({
        sandboxInstanceId: "sbi_12345678901234567890123456",
        sandbox: {
          provider: SandboxProvider.DOCKER,
          id: "docker-runtime-id",
        },
        storage: {
          backend: SandboxAttachedStorageBackends.ARCHIL,
          handle: "dsk-0123456789abcdef",
          region: "aws-us-east-1",
          credential: "token",
        },
        lifecycle: "start",
      }),
    ).resolves.toBeUndefined();

    await expect(
      adapter.cleanupStorage({
        sandboxInstanceId: "sbi_12345678901234567890123456",
        sandbox: {
          provider: SandboxProvider.DOCKER,
          id: "docker-runtime-id",
        },
        storage: {
          backend: SandboxAttachedStorageBackends.ARCHIL,
          handle: "dsk-0123456789abcdef",
          region: "aws-us-east-1",
        },
        lifecycle: "stop",
        timing: "before_compute_teardown",
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps e2b storage preparation as a no-op in this phase", async () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.E2B,
      e2b: {
        apiKey: "test-api-key",
      },
    });

    await expect(
      adapter.prepareStorageForStart({
        sandboxInstanceId: "sbi_12345678901234567890123456",
      }),
    ).resolves.toEqual({});
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

    expect(typeof runtimeControl.init).toBe("function");
    expect(typeof runtimeControl.resume).toBe("function");
    expect(typeof runtimeControl.close).toBe("function");
  });

  it("throws when docker runtime control config is missing", () => {
    expect(() =>
      createSandboxRuntimeControl({
        provider: SandboxProvider.DOCKER,
      }),
    ).toThrow(SandboxConfigurationError);
  });

  it("creates an E2B runtime control when E2B config is provided", () => {
    const runtimeControl = createSandboxRuntimeControl({
      provider: SandboxProvider.E2B,
      e2b: {
        apiKey: "test-api-key",
      },
    });

    expect(typeof runtimeControl.init).toBe("function");
    expect(typeof runtimeControl.resume).toBe("function");
    expect(typeof runtimeControl.close).toBe("function");
  });

  it("throws when E2B runtime control config is missing", () => {
    expect(() =>
      createSandboxRuntimeControl({
        provider: SandboxProvider.E2B,
      }),
    ).toThrow(SandboxConfigurationError);
  });
});

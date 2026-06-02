import { describe, expect, it } from "vitest";

import { SandboxConfigurationError } from "./errors.js";
import {
  createSandboxAdapter,
  createSandboxBaseImageBuilder,
  createSandboxRuntimeControl,
} from "./factory.js";
import { SandboxProvider, SandboxTransparentProxyBypassKinds } from "./types.js";

describe("createSandboxAdapter", () => {
  it("creates a docker adapter when docker config is provided", () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: "/var/run/docker.sock",
      },
    });

    expect(typeof adapter.prepareImage).toBe("function");
    expect(typeof adapter.start).toBe("function");
    expect(typeof adapter.inspect).toBe("function");
    expect(typeof adapter.resume).toBe("function");
    expect(typeof adapter.captureSnapshot).toBe("function");
    expect(typeof adapter.stop).toBe("function");
    expect(typeof adapter.destroy).toBe("function");
    expect(adapter.getTransparentProxyConfiguration()).toMatchObject({
      provider: SandboxProvider.DOCKER,
      passthroughBypass: {
        kind: SandboxTransparentProxyBypassKinds.SOCKET_MARK,
      },
    });
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

    expect(typeof adapter.prepareImage).toBe("function");
    expect(typeof adapter.start).toBe("function");
    expect(typeof adapter.inspect).toBe("function");
    expect(typeof adapter.resume).toBe("function");
    expect(typeof adapter.captureSnapshot).toBe("function");
    expect(typeof adapter.stop).toBe("function");
    expect(typeof adapter.destroy).toBe("function");
    expect(adapter.getTransparentProxyConfiguration()).toMatchObject({
      provider: SandboxProvider.E2B,
      passthroughBypass: {
        kind: SandboxTransparentProxyBypassKinds.SOCKET_MARK,
      },
    });
  });

  it("throws when E2B config is missing", () => {
    expect(() =>
      createSandboxAdapter({
        provider: SandboxProvider.E2B,
      }),
    ).toThrow(SandboxConfigurationError);
  });

  it("creates a Tensorlake adapter when Tensorlake config is provided", () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.TENSORLAKE,
      tensorlake: {
        apiKey: "test-api-key",
      },
    });

    expect(typeof adapter.prepareImage).toBe("function");
    expect(typeof adapter.start).toBe("function");
    expect(typeof adapter.inspect).toBe("function");
    expect(typeof adapter.resume).toBe("function");
    expect(typeof adapter.captureSnapshot).toBe("function");
    expect(typeof adapter.stop).toBe("function");
    expect(typeof adapter.destroy).toBe("function");
    expect(adapter.getTransparentProxyConfiguration()).toMatchObject({
      provider: SandboxProvider.TENSORLAKE,
      passthroughBypass: {
        kind: SandboxTransparentProxyBypassKinds.SOCKET_MARK,
      },
    });
  });

  it("throws when Tensorlake config is missing", () => {
    expect(() =>
      createSandboxAdapter({
        provider: SandboxProvider.TENSORLAKE,
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

    expect(typeof runtimeControl.beginInit).toBe("function");
    expect(typeof runtimeControl.init).toBe("function");
    expect(typeof runtimeControl.waitInit).toBe("function");
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

    expect(typeof runtimeControl.beginInit).toBe("function");
    expect(typeof runtimeControl.init).toBe("function");
    expect(typeof runtimeControl.waitInit).toBe("function");
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

  it("creates a Tensorlake runtime control when Tensorlake config is provided", () => {
    const runtimeControl = createSandboxRuntimeControl({
      provider: SandboxProvider.TENSORLAKE,
      tensorlake: {
        apiKey: "test-api-key",
      },
    });

    expect(typeof runtimeControl.init).toBe("function");
    expect(typeof runtimeControl.resume).toBe("function");
    expect(typeof runtimeControl.close).toBe("function");
  });

  it("throws when Tensorlake runtime control config is missing", () => {
    expect(() =>
      createSandboxRuntimeControl({
        provider: SandboxProvider.TENSORLAKE,
      }),
    ).toThrow(SandboxConfigurationError);
  });
});

describe("createSandboxBaseImageBuilder", () => {
  it("creates a docker base image builder without runtime Docker config", () => {
    const builder = createSandboxBaseImageBuilder({
      provider: SandboxProvider.DOCKER,
    });

    expect(typeof builder.ensureBaseImage).toBe("function");
  });

  it("creates an E2B base image builder when E2B config is provided", () => {
    const builder = createSandboxBaseImageBuilder({
      provider: SandboxProvider.E2B,
      e2b: {
        apiKey: "test-api-key",
      },
    });

    expect(typeof builder.ensureBaseImage).toBe("function");
  });

  it("throws when E2B base image builder config is missing", () => {
    expect(() =>
      createSandboxBaseImageBuilder({
        provider: SandboxProvider.E2B,
      }),
    ).toThrow(SandboxConfigurationError);
  });

  it("creates a Tensorlake base image builder when Tensorlake config is provided", () => {
    const builder = createSandboxBaseImageBuilder({
      provider: SandboxProvider.TENSORLAKE,
      tensorlake: {
        apiKey: "test-api-key",
      },
    });

    expect(typeof builder.ensureBaseImage).toBe("function");
  });

  it("throws when Tensorlake base image builder config is missing", () => {
    expect(() =>
      createSandboxBaseImageBuilder({
        provider: SandboxProvider.TENSORLAKE,
      }),
    ).toThrow(SandboxConfigurationError);
  });
});

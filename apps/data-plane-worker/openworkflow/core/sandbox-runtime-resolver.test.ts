import { describe, expect, it } from "vitest";

import {
  createE2BSandboxProviderConfig,
  createModalSandboxProviderConfig,
  createOpenComputerSandboxProviderConfig,
  createResolveSandboxRuntimeInput,
  createTensorlakeSandboxProviderConfig,
} from "./sandbox-runtime-resolver.js";

describe("createE2BSandboxProviderConfig", () => {
  it("maps profile-version vCPU and memory resources into E2B provider config", () => {
    expect(
      createE2BSandboxProviderConfig({
        credentials: {
          provider: "e2b",
          source: "connection",
          apiKey: "e2b-api-key",
          domain: "e2b.example.com",
        },
        resources: {
          vcpuCount: 4,
          memoryMb: 8192,
        },
      }),
    ).toEqual({
      provider: "e2b",
      e2b: {
        apiKey: "e2b-api-key",
        domain: "e2b.example.com",
        cpuCount: 4,
        memoryMb: 8192,
      },
    });
  });

  it("rejects disk because E2B does not advertise configurable disk", () => {
    expect(() =>
      createE2BSandboxProviderConfig({
        credentials: {
          provider: "e2b",
          source: "managed",
          apiKey: "e2b-api-key",
        },
        resources: {
          vcpuCount: 2,
          memoryMb: 4096,
          diskMb: 1024,
        },
      }),
    ).toThrow("E2B sandbox runtime does not support configurable disk.");
  });
});

describe("createTensorlakeSandboxProviderConfig", () => {
  it("accepts profile-version disk resources", () => {
    expect(
      createTensorlakeSandboxProviderConfig({
        credentials: {
          provider: "tensorlake",
          source: "managed",
          apiKey: "tensorlake-api-key",
        },
        resources: {
          vcpuCount: 4,
          memoryMb: 16384,
          diskMb: 20480,
        },
      }),
    ).toEqual({
      provider: "tensorlake",
      tensorlake: {
        apiKey: "tensorlake-api-key",
      },
    });
  });
});

describe("createModalSandboxProviderConfig", () => {
  it("maps connection-sourced Modal credentials into provider config", () => {
    expect(
      createModalSandboxProviderConfig({
        credentials: {
          provider: "modal",
          source: "connection",
          tokenId: "ak-modal-token-id",
          tokenSecret: "as-modal-token-secret",
          appName: "mistle-modal-sandboxes",
        },
        resources: {
          vcpuCount: 4,
          memoryMb: 16384,
        },
      }),
    ).toEqual({
      provider: "modal",
      modal: {
        tokenId: "ak-modal-token-id",
        tokenSecret: "as-modal-token-secret",
        appName: "mistle-modal-sandboxes",
      },
    });
  });
});

describe("createOpenComputerSandboxProviderConfig", () => {
  it("strips release-manifest target metadata from sandboxd artifacts", () => {
    const artifact = {
      version: "0.32.0",
      target: "x86_64-unknown-linux-gnu",
      url: "https://github.com/mistlehq/mistle/releases/download/v0.32.0/sandboxd-x86_64-unknown-linux-gnu.tar.gz",
      sha256: "a".repeat(64),
    };

    expect(
      createOpenComputerSandboxProviderConfig({
        credentials: {
          provider: "opencomputer",
          source: "connection",
          apiKey: "opencomputer-api-key",
        },
        sandboxd: {
          kind: "release",
          artifact,
        },
      }),
    ).toEqual({
      provider: "opencomputer",
      opencomputer: {
        apiKey: "opencomputer-api-key",
        sandboxd: {
          kind: "release",
          artifact: {
            version: "0.32.0",
            url: "https://github.com/mistlehq/mistle/releases/download/v0.32.0/sandboxd-x86_64-unknown-linux-gnu.tar.gz",
            sha256: "a".repeat(64),
          },
        },
      },
    });
  });
});

describe("createResolveSandboxRuntimeInput", () => {
  it("reconstructs a selected connection-backed sandbox runtime from persisted columns", () => {
    expect(
      createResolveSandboxRuntimeInput({
        organizationId: "org_runtime_selection",
        runtimeProvider: "e2b",
        sandboxConnectionId: "icn_runtime_selection",
        sandboxVcpuCount: 4,
        sandboxMemoryMb: 8192,
        sandboxDiskMb: null,
      }),
    ).toEqual({
      organizationId: "org_runtime_selection",
      provider: "e2b",
      connectionId: "icn_runtime_selection",
      resources: {
        vcpuCount: 4,
        memoryMb: 8192,
      },
    });
  });

  it("rejects incomplete persisted sandbox runtime resources", () => {
    expect(() =>
      createResolveSandboxRuntimeInput({
        organizationId: "org_runtime_selection",
        runtimeProvider: "e2b",
        sandboxConnectionId: null,
        sandboxVcpuCount: 4,
        sandboxMemoryMb: null,
        sandboxDiskMb: null,
      }),
    ).toThrow("Persisted sandbox resources are incomplete.");
  });
});

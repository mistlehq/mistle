import { describe, expect, it } from "vitest";

import { createE2BSandboxProviderConfig } from "./sandbox-runtime-resolver.js";

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

  it("rejects storage because E2B does not advertise configurable storage", () => {
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
          storageMb: 1024,
        },
      }),
    ).toThrow("E2B sandbox runtime does not support configurable storage.");
  });
});

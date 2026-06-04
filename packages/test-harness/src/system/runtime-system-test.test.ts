import { SandboxResourceNotFoundError } from "@mistle/sandbox";
import { afterEach, describe, expect, it } from "vitest";

import { ServiceIds } from "../integration/services/service-ids.js";
import { createDockerSandboxReachableHostUrl } from "./docker-sandbox-networking.js";
import { IntegrationConfigPathInContainer } from "./integration-config-paths.js";
import {
  createRuntimeSystemServiceOptions,
  resolveRuntimeSystemIntegrationConfigPathInContainer,
  selectProviderSandboxIdsCreatedByTest,
  shouldIgnoreRuntimeSystemProviderSandboxCleanupError,
} from "./runtime-system-test.js";
import { MISTLE_SYSTEM_TEST_TENSORLAKE_SANDBOX_BASE_IMAGE_REF_ENV } from "./system-test-sandbox-base-image.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("resolveRuntimeSystemIntegrationConfigPathInContainer", () => {
  it("uses the shared integration config for non-sandbox runtime system tests", () => {
    expect(resolveRuntimeSystemIntegrationConfigPathInContainer({})).toBe(
      IntegrationConfigPathInContainer,
    );
  });

  it("uses the shared integration config for Docker sandbox runtime system tests", () => {
    expect(
      resolveRuntimeSystemIntegrationConfigPathInContainer({
        sandbox: {
          provider: "docker",
        },
      }),
    ).toBe(IntegrationConfigPathInContainer);
  });

  it("uses the shared integration config for E2B sandbox runtime system tests", () => {
    expect(
      resolveRuntimeSystemIntegrationConfigPathInContainer({
        sandbox: {
          provider: "e2b",
        },
      }),
    ).toBe(IntegrationConfigPathInContainer);
  });

  it("uses the shared integration config for Tensorlake sandbox runtime system tests", () => {
    expect(
      resolveRuntimeSystemIntegrationConfigPathInContainer({
        sandbox: {
          provider: "tensorlake",
        },
      }),
    ).toBe(IntegrationConfigPathInContainer);
  });
});

describe("createRuntimeSystemServiceOptions", () => {
  it("keeps Docker sandbox startup on private harness service URLs when public access is provisioned", async () => {
    await expect(
      createRuntimeSystemServiceOptions({
        sandbox: {
          provider: "docker",
        },
        publicAccess: {
          provider: "cloudflare",
          services: [ServiceIds.DATA_PLANE_GATEWAY],
        },
      }),
    ).resolves.toEqual({
      sandbox: {
        provider: "docker",
      },
    });
  });

  it("uses an explicit Tensorlake image override and enables release artifact resolution", async () => {
    process.env.MISTLE_SANDBOX_TENSORLAKE_API_KEY = "tensorlake-api-key";
    process.env[MISTLE_SYSTEM_TEST_TENSORLAKE_SANDBOX_BASE_IMAGE_REF_ENV] =
      "tensorlake:image:mistle-system-test";

    await expect(
      createRuntimeSystemServiceOptions({
        sandbox: {
          provider: "tensorlake",
        },
      }),
    ).resolves.toEqual({
      dataPlaneWorker: {
        sandboxdArtifactResolver: "release",
      },
      sandbox: {
        provider: "tensorlake",
        defaultBaseImageRef: "tensorlake:image:mistle-system-test",
        tensorlake: {
          apiKey: "tensorlake-api-key",
        },
        publicServiceBaseUrls: new Map(),
      },
    });
  });
});

describe("selectProviderSandboxIdsCreatedByTest", () => {
  it("returns only provider sandbox ids created after the runtime system test baseline", () => {
    expect(
      selectProviderSandboxIdsCreatedByTest({
        baselineProviderSandboxIds: new Set(["provider-before", "provider-shared"]),
        currentProviderSandboxIds: new Set([
          "provider-new-b",
          "provider-before",
          "provider-new-a",
          "provider-shared",
        ]),
      }),
    ).toEqual(["provider-new-a", "provider-new-b"]);
  });
});

describe("shouldIgnoreRuntimeSystemProviderSandboxCleanupError", () => {
  it("treats already-destroyed provider sandboxes as successful runtime system cleanup", () => {
    expect(
      shouldIgnoreRuntimeSystemProviderSandboxCleanupError(
        new SandboxResourceNotFoundError({
          resourceType: "sandbox",
          resourceId: "provider-gone",
        }),
      ),
    ).toBe(true);
  });

  it("keeps unexpected provider cleanup errors fatal", () => {
    expect(shouldIgnoreRuntimeSystemProviderSandboxCleanupError(new Error("boom"))).toBe(false);
  });
});

describe("createDockerSandboxReachableHostUrl", () => {
  it("rewrites a host URL to the Docker host gateway name", () => {
    expect(createDockerSandboxReachableHostUrl("http://127.0.0.1:8080/upstream")).toBe(
      "http://host.docker.internal:8080/upstream",
    );
  });
});

import { describe, expect, it } from "vitest";

import { ServiceIds } from "../integration/services/service-ids.js";
import { createDockerSandboxReachableHostUrl } from "./docker-sandbox-networking.js";
import {
  DockerIntegrationConfigPathInContainer,
  E2BIntegrationConfigPathInContainer,
} from "./integration-config-paths.js";
import {
  createRuntimeSystemServiceOptions,
  resolveRuntimeSystemIntegrationConfigPathInContainer,
  selectE2BProviderSandboxIdsCreatedByTest,
} from "./runtime-system-test.js";

describe("resolveRuntimeSystemIntegrationConfigPathInContainer", () => {
  it("uses the Docker integration config for non-sandbox runtime system tests", () => {
    expect(resolveRuntimeSystemIntegrationConfigPathInContainer({})).toBe(
      DockerIntegrationConfigPathInContainer,
    );
  });

  it("uses the Docker integration config for Docker sandbox runtime system tests", () => {
    expect(
      resolveRuntimeSystemIntegrationConfigPathInContainer({
        sandbox: {
          provider: "docker",
        },
      }),
    ).toBe(DockerIntegrationConfigPathInContainer);
  });

  it("uses the E2B integration config for E2B sandbox runtime system tests", () => {
    expect(
      resolveRuntimeSystemIntegrationConfigPathInContainer({
        sandbox: {
          provider: "e2b",
        },
      }),
    ).toBe(E2BIntegrationConfigPathInContainer);
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
          services: [ServiceIds.DATA_PLANE_GATEWAY, ServiceIds.TOKENIZER_PROXY],
        },
      }),
    ).resolves.toEqual({
      sandbox: {
        provider: "docker",
      },
    });
  });

  it("marks Docker sandbox system tests for gateway proxy mode when requested", async () => {
    await expect(
      createRuntimeSystemServiceOptions({
        sandbox: {
          provider: "docker",
        },
        gatewayProxy: true,
      }),
    ).resolves.toEqual({
      sandbox: {
        provider: "docker",
        gatewayProxy: true,
      },
    });
  });
});

describe("selectE2BProviderSandboxIdsCreatedByTest", () => {
  it("returns only provider sandbox ids created after the runtime system test baseline", () => {
    expect(
      selectE2BProviderSandboxIdsCreatedByTest({
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

describe("createDockerSandboxReachableHostUrl", () => {
  it("rewrites a host URL to the Docker host gateway name", () => {
    expect(createDockerSandboxReachableHostUrl("http://127.0.0.1:8080/upstream")).toBe(
      "http://host.docker.internal:8080/upstream",
    );
  });
});

import { afterEach, describe, expect, it } from "vitest";

import {
  createTestRegistry,
  IntegrationConfigPathInContainer,
  startTestEnvironment,
} from "../src/index.js";

const startedEnvironments: Awaited<ReturnType<typeof startTestEnvironment>>[] = [];
const HttpServiceIds = ["control-plane-api", "data-plane-api", "data-plane-gateway"] as const;

describe("Mistle test registry", () => {
  afterEach(async () => {
    const environments = startedEnvironments.splice(0, startedEnvironments.length);
    await Promise.all(environments.map(async (environment) => environment.stop()));
  });

  it("starts data-plane-api without starting control-plane-api", async () => {
    const registry = createTestRegistry({
      configPathInContainer: IntegrationConfigPathInContainer,
      __dangerouslyIsolatedServices: {
        reason:
          "This smoke proves optional service references do not force subset integration tests to start unrelated Mistle services.",
      },
    });
    const environment = await startTestEnvironment({
      registry,
      services: [{ service: "data-plane-api", mode: "docker" }],
    });
    startedEnvironments.push(environment);

    expect(environment.services.keys()).toEqual(["data-plane-api"]);
    const dataPlaneApi = environment.services.get("data-plane-api");
    if (dataPlaneApi.http === undefined) {
      throw new Error("Expected data-plane-api to expose an HTTP client.");
    }

    const response = await dataPlaneApi.http.fetch("/__healthz");
    expect(response.status).toBe(200);
  }, 180_000);

  it("starts the full concrete Mistle service graph through the registry", async () => {
    const registry = createTestRegistry({
      configPathInContainer: IntegrationConfigPathInContainer,
      __dangerouslyIsolatedServices: {
        reason:
          "This smoke starts the entire graph and should not reuse partially-started services from smaller registry smoke tests.",
      },
    });
    const environment = await startTestEnvironment({
      registry,
      services: [
        { service: "control-plane-api", mode: "docker" },
        { service: "data-plane-api", mode: "docker" },
        { service: "data-plane-gateway", mode: "docker" },
        { service: "control-plane-worker", mode: "docker" },
        { service: "data-plane-worker", mode: "docker" },
      ],
    });
    startedEnvironments.push(environment);

    for (const serviceId of HttpServiceIds) {
      const service = environment.services.get(serviceId);
      if (service.http === undefined) {
        throw new Error(`Expected ${serviceId} to expose an HTTP client.`);
      }

      const response = await service.http.fetch("/__healthz");
      expect(response.status).toBe(200);
    }

    expect(environment.services.get("control-plane-worker").containerId).toBeDefined();
    expect(environment.services.get("data-plane-worker").containerId).toBeDefined();
  }, 300_000);
});

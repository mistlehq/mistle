import { afterEach, describe, expect, it } from "vitest";

import { createTestRegistry, startTestEnvironment } from "../src/index.js";

const DockerSampleConfigPathInContainer = "/app/config/config.docker.sample.toml";
const TrustedControlPlaneOrigin = "http://localhost:5100";
const startedEnvironments: Awaited<ReturnType<typeof startTestEnvironment>>[] = [];
const HttpServiceIds = [
  "control-plane-api",
  "data-plane-api",
  "data-plane-gateway",
  "tokenizer-proxy",
] as const;

describe("Mistle test registry", () => {
  afterEach(async () => {
    const environments = startedEnvironments.splice(0, startedEnvironments.length);
    await Promise.all(environments.map(async (environment) => environment.stop()));
  });

  it("starts tokenizer-proxy with a selected control-plane reference", async () => {
    const registry = createTestRegistry({
      configPathInContainer: DockerSampleConfigPathInContainer,
    });
    const environment = await startTestEnvironment({
      registry,
      services: [
        { service: "control-plane-api", mode: "docker" },
        { service: "tokenizer-proxy", mode: "docker" },
      ],
    });
    startedEnvironments.push(environment);

    const tokenizerProxy = environment.services.get("tokenizer-proxy");
    if (tokenizerProxy.http === undefined) {
      throw new Error("Expected tokenizer-proxy to expose an HTTP client.");
    }

    const response = await tokenizerProxy.http.fetch("/__healthz");
    expect(response.status).toBe(200);

    const missingGrantResponse = await tokenizerProxy.http.fetch(
      "/tokenizer-proxy/egress/v1/responses",
      {
        method: "POST",
      },
    );
    expect(missingGrantResponse.status).toBe(401);
    await expect(missingGrantResponse.json()).resolves.toMatchObject({
      code: "INVALID_EGRESS_GRANT",
      message: "Egress grant token is required.",
    });

    const controlPlaneApi = environment.services.get("control-plane-api");
    if (controlPlaneApi.http === undefined) {
      throw new Error("Expected control-plane-api to expose an HTTP client.");
    }

    const corsResponse = await controlPlaneApi.http.fetch("/__healthz", {
      headers: {
        origin: TrustedControlPlaneOrigin,
      },
    });
    expect(corsResponse.status).toBe(200);
    expect(corsResponse.headers.get("access-control-allow-origin")).toBe(TrustedControlPlaneOrigin);
    expect(corsResponse.headers.get("access-control-allow-credentials")).toBe("true");
  }, 180_000);

  it("starts data-plane-api without starting control-plane-api", async () => {
    const registry = createTestRegistry({
      configPathInContainer: DockerSampleConfigPathInContainer,
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

    const unauthenticatedResponse = await dataPlaneApi.http.fetch("/internal/sandbox/instances", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(unauthenticatedResponse.status).toBe(401);
    await expect(unauthenticatedResponse.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  }, 180_000);

  it("starts the full concrete Mistle service graph through the registry", async () => {
    const registry = createTestRegistry({
      configPathInContainer: DockerSampleConfigPathInContainer,
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
        { service: "tokenizer-proxy", mode: "docker" },
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

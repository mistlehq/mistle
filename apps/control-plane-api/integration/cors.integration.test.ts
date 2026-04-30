import {
  createTestRegistry,
  startTestEnvironment,
  type TestEnvironment,
  type TestHttpClient,
  type TestServiceHandle,
} from "@mistle/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DockerSampleConfigPathInContainer = "/app/config/config.docker.sample.toml";
const TrustedOrigin = "http://localhost:5100";

type ControlPlaneApiEnvironment = TestEnvironment<"control-plane-api">;

let environment: ControlPlaneApiEnvironment | undefined;

function readEnvironment(): ControlPlaneApiEnvironment {
  if (environment === undefined) {
    throw new Error("Expected the control-plane-api test environment to be started.");
  }

  return environment;
}

function readHttpClient(service: TestServiceHandle): TestHttpClient {
  if (service.http === undefined) {
    throw new Error(`Expected ${service.id} to expose an HTTP client.`);
  }

  return service.http;
}

function controlPlaneApiClient(): TestHttpClient {
  return readHttpClient(readEnvironment().services.get("control-plane-api"));
}

describe("cors integration", () => {
  beforeAll(async () => {
    environment = await startTestEnvironment({
      registry: createTestRegistry({
        configPathInContainer: DockerSampleConfigPathInContainer,
      }),
      services: [{ service: "control-plane-api", mode: "docker" }],
    });
  }, 180_000);

  afterAll(async () => {
    await environment?.stop();
  });

  it("adds CORS headers for trusted origins on standard requests", async () => {
    const response = await controlPlaneApiClient().fetch("/__healthz", {
      method: "GET",
      headers: {
        origin: TrustedOrigin,
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(TrustedOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not allow untrusted origins on standard requests", async () => {
    const response = await controlPlaneApiClient().fetch("/__healthz", {
      method: "GET",
      headers: {
        origin: "http://malicious.example",
      },
    });
    expect(response.status).toBe(200);

    const allowOrigin = response.headers.get("access-control-allow-origin");
    expect(allowOrigin === null || allowOrigin === "").toBe(true);
  });

  it("handles preflight requests for trusted origins", async () => {
    const response = await controlPlaneApiClient().fetch("/__healthz", {
      method: "OPTIONS",
      headers: {
        origin: TrustedOrigin,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type,authorization",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(TrustedOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-methods")).toContain("PUT");
    expect(response.headers.get("access-control-allow-methods")).toContain("OPTIONS");
    expect(response.headers.get("access-control-max-age")).toBe("600");

    const allowHeaders = response.headers.get("access-control-allow-headers");
    expect(allowHeaders).toContain("Content-Type");
    expect(allowHeaders).toContain("Authorization");
  });
});

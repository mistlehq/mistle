import { describe, expect, it } from "vitest";

import { resolveSandboxRuntimeTracesEndpoint } from "./start-sandbox.js";

describe("resolveSandboxRuntimeTracesEndpoint", () => {
  it("returns undefined when telemetry is disabled", () => {
    const endpoint = resolveSandboxRuntimeTracesEndpoint({
      sandboxProvider: "docker",
      telemetryConfig: {
        enabled: false,
        debug: false,
      },
    });

    expect(endpoint).toBeUndefined();
  });

  it("rewrites loopback host to host.docker.internal for docker sandboxes", () => {
    const endpoint = resolveSandboxRuntimeTracesEndpoint({
      sandboxProvider: "docker",
      telemetryConfig: {
        enabled: true,
        debug: false,
        traces: {
          endpoint: "http://127.0.0.1:4318/v1/traces",
        },
        logs: {
          endpoint: "http://127.0.0.1:4318/v1/logs",
        },
        metrics: {
          endpoint: "http://127.0.0.1:4318/v1/metrics",
        },
      },
    });

    expect(endpoint).toBe("http://host.docker.internal:4318/v1/traces");
  });

  it("keeps the endpoint unchanged for modal sandboxes", () => {
    const endpoint = resolveSandboxRuntimeTracesEndpoint({
      sandboxProvider: "modal",
      telemetryConfig: {
        enabled: true,
        debug: false,
        traces: {
          endpoint: "http://127.0.0.1:4318/v1/traces",
        },
        logs: {
          endpoint: "http://127.0.0.1:4318/v1/logs",
        },
        metrics: {
          endpoint: "http://127.0.0.1:4318/v1/metrics",
        },
      },
    });

    expect(endpoint).toBe("http://127.0.0.1:4318/v1/traces");
  });
});

import { describe, expect, it } from "vitest";

import { resolveSandboxExtraHosts, resolveSandboxRuntimeTracesEndpoint } from "./start-sandbox.js";

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

describe("resolveSandboxExtraHosts", () => {
  it("returns undefined for non-docker sandboxes", () => {
    const extraHosts = resolveSandboxExtraHosts({
      sandboxProvider: "modal",
      tokenizerProxyEgressBaseUrl:
        "http://host.testcontainers.internal:8080/tokenizer-proxy/egress",
      sandboxRuntimeTracesEndpoint: "http://host.docker.internal:4318/v1/traces",
    });

    expect(extraHosts).toBeUndefined();
  });

  it("adds required host-gateway aliases for docker sandbox URLs and deduplicates them", () => {
    const extraHosts = resolveSandboxExtraHosts({
      sandboxProvider: "docker",
      tokenizerProxyEgressBaseUrl:
        "http://host.testcontainers.internal:8080/tokenizer-proxy/egress",
      sandboxRuntimeTracesEndpoint: "http://host.docker.internal:4318/v1/traces",
    });

    expect(extraHosts).toEqual([
      "host.testcontainers.internal:host-gateway",
      "host.docker.internal:host-gateway",
    ]);
  });

  it("ignores URLs that do not need docker host-gateway aliases", () => {
    const extraHosts = resolveSandboxExtraHosts({
      sandboxProvider: "docker",
      tokenizerProxyEgressBaseUrl: "http://tokenizer-proxy:8080/tokenizer-proxy/egress",
      sandboxRuntimeTracesEndpoint: "http://otel-collector:4318/v1/traces",
    });

    expect(extraHosts).toBeUndefined();
  });
});

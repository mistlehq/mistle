import { describe, expect, it } from "vitest";

import { resolveSandboxExtraHosts } from "./start-sandbox.js";

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

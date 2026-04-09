import { once } from "node:events";
import { createServer } from "node:http";

import { metrics } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";

import { createOtlpLogForwarder, initializeTelemetryFromConfig } from "./index.js";

type CapturedOtlpRequest = {
  body: Buffer;
  path: string;
};

async function startOtlpTestServer(): Promise<{
  close: () => Promise<void>;
  endpointForPath: (path: string) => string;
  requests: CapturedOtlpRequest[];
}> {
  const requests: CapturedOtlpRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Uint8Array[] = [];

    request.on("data", (chunk: Uint8Array) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      requests.push({
        body: Buffer.concat(chunks),
        path: request.url ?? "/",
      });
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end("{}");
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the OTLP test server to bind an ephemeral TCP port.");
  }

  return {
    close: async () => {
      server.close();
      await once(server, "close");
    },
    endpointForPath: (path) => `http://127.0.0.1:${String(address.port)}${path}`,
    requests,
  };
}

describe("createOtlpLogForwarder", () => {
  it("exports OTLP logs to the configured endpoint", async () => {
    const server = await startOtlpTestServer();

    const forwarder = createOtlpLogForwarder({
      serviceName: "@mistle/sandboxd",
      resourceAttributes: "deployment.environment=test",
      logs: {
        endpoint: server.endpointForPath("/v1/logs"),
      },
    });

    try {
      forwarder.emit({
        body: "sandbox runtime started",
        severityText: "INFO",
      });
      await forwarder.shutdown();
    } finally {
      await server.close();
    }

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.path).toBe("/v1/logs");
    expect(server.requests[0]?.body.toString("utf8")).toContain("@mistle/sandboxd");
    expect(server.requests[0]?.body.toString("utf8")).toContain("sandbox runtime started");
  });

  it("exports OTLP metrics and preserves an explicit instrumentation allowlist", async () => {
    const server = await startOtlpTestServer();
    const originalInstrumentationEnv = process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS;
    process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS = "http,redis";

    try {
      const telemetry = initializeTelemetryFromConfig({
        serviceName: "@mistle/telemetry-integration-test",
        config: {
          enabled: true,
          debug: false,
          traces: {
            endpoint: server.endpointForPath("/v1/traces"),
          },
          logs: {
            endpoint: server.endpointForPath("/v1/logs"),
          },
          metrics: {
            endpoint: server.endpointForPath("/v1/metrics"),
          },
        },
      });

      const counter = metrics
        .getMeter("@mistle/telemetry-integration-test")
        .createCounter("mistle.telemetry.integration.counter");
      counter.add(1);

      await telemetry.shutdown();
      await server.close();

      expect(process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS).toBe("http,redis");
      expect(server.requests.some((request) => request.path === "/v1/metrics")).toBe(true);
      expect(
        server.requests.some(
          (request) => request.path === "/v1/metrics" && request.body.byteLength > 0,
        ),
      ).toBe(true);
    } finally {
      if (originalInstrumentationEnv === undefined) {
        delete process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS;
      } else {
        process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS = originalInstrumentationEnv;
      }
      await server.close().catch(() => {});
    }
  });
});

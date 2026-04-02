import { once } from "node:events";
import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { createOtlpLogForwarder } from "./index.js";

describe("createOtlpLogForwarder", () => {
  it("exports OTLP logs to the configured endpoint", async () => {
    const requests: {
      body: string;
    }[] = [];

    const server = createServer((request, response) => {
      const chunks: Uint8Array[] = [];

      request.on("data", (chunk: Uint8Array) => {
        chunks.push(chunk);
      });
      request.on("end", () => {
        requests.push({
          body: Buffer.concat(chunks).toString("utf8"),
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

    const forwarder = createOtlpLogForwarder({
      serviceName: "@mistle/sandbox-runtime",
      resourceAttributes: "deployment.environment=test",
      logs: {
        endpoint: `http://127.0.0.1:${String(address.port)}/v1/logs`,
      },
    });

    try {
      forwarder.emit({
        body: "sandbox runtime started",
        severityText: "INFO",
      });
      await forwarder.shutdown();
    } finally {
      server.close();
      await once(server, "close");
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toContain("@mistle/sandbox-runtime");
    expect(requests[0]?.body).toContain("sandbox runtime started");
  });
});

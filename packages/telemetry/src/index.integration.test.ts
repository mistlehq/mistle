import { once } from "node:events";
import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { createOtlpLogForwarder } from "./index.js";

describe("createOtlpLogForwarder", () => {
  it("sends configured OTLP headers on export", async () => {
    const requests: {
      headers: Record<string, string | undefined>;
      body: string;
    }[] = [];

    const server = createServer((request, response) => {
      const chunks: Uint8Array[] = [];

      request.on("data", (chunk: Uint8Array) => {
        chunks.push(chunk);
      });
      request.on("end", () => {
        requests.push({
          headers: {
            authorization:
              typeof request.headers.authorization === "string"
                ? request.headers.authorization
                : undefined,
            "x-scope-orgid":
              typeof request.headers["x-scope-orgid"] === "string"
                ? request.headers["x-scope-orgid"]
                : undefined,
          },
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
        headers: {
          authorization: "Bearer test-token",
          "x-scope-orgid": "tenant-a",
        },
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
    expect(requests[0]?.headers).toEqual({
      authorization: "Bearer test-token",
      "x-scope-orgid": "tenant-a",
    });
    expect(requests[0]?.body).toContain("@mistle/sandbox-runtime");
    expect(requests[0]?.body).toContain("sandbox runtime started");
  });
});

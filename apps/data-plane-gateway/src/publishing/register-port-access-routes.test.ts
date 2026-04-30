import { describe, expect, it } from "vitest";

import { createPortAccessHttpResponse } from "./register-port-access-routes.js";

function createBodyStream(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from(body, "utf8"));
      controller.close();
    },
  });
}

describe("port access route response handling", () => {
  it("creates normal HTTP responses with tunneled body streams", async () => {
    const response = createPortAccessHttpResponse({
      close: async () => undefined,
      responseBody: createBodyStream("hello"),
      responseStart: {
        type: "ports.http.response.start",
        streamId: 41,
        status: 200,
        headers: {
          "content-type": ["text/plain; charset=utf-8"],
        },
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    await expect(response.text()).resolves.toBe("hello");
  });

  it("creates null-body HTTP responses without attaching a body stream", async () => {
    const response = createPortAccessHttpResponse({
      close: async () => undefined,
      responseBody: createBodyStream("must not be attached"),
      responseStart: {
        type: "ports.http.response.start",
        streamId: 41,
        status: 204,
        headers: {
          "cache-control": ["no-store"],
        },
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toBe("");
  });
});

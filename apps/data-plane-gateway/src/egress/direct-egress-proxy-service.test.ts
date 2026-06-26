import { describe, expect, it } from "vitest";

import { toObservableResponseHeaders } from "./direct-egress-proxy-service.js";

describe("toObservableResponseHeaders", () => {
  it("keeps only response headers that help diagnose streaming behavior", () => {
    const headers = toObservableResponseHeaders({
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-length": "0",
      "content-type": "text/event-stream",
      "set-cookie": ["session=secret"],
      "transfer-encoding": "chunked",
      "www-authenticate": 'Bearer error="invalid_token"',
    });

    expect(headers).toEqual({
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-length": "0",
      "content-type": "text/event-stream",
      "transfer-encoding": "chunked",
    });
    expect(headers).not.toHaveProperty("set-cookie");
    expect(headers).not.toHaveProperty("www-authenticate");
  });

  it("preserves missing header keys with undefined values for stable log shape", () => {
    const headers = toObservableResponseHeaders({
      "content-type": "application/json",
    });

    expect(headers).toEqual({
      "cache-control": undefined,
      connection: undefined,
      "content-length": undefined,
      "content-type": "application/json",
      "transfer-encoding": undefined,
    });
  });
});

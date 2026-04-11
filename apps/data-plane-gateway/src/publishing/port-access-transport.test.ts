import { describe, expect, it } from "vitest";

import {
  buildPortAccessRequestHeaders,
  toPortAccessResponseHeaders,
} from "./port-access-transport.js";

describe("port access transport helpers", () => {
  it("rewrites browser request headers for tunneled upstream delivery", () => {
    const requestHeaders = new Headers([
      ["accept", "text/html"],
      ["cookie", "mistle_port_access_session=session-token; theme=dark"],
      ["connection", "keep-alive"],
      ["host", "p-5173--sandbox.mistle.localhost"],
      ["x-request-marker", "req-123"],
    ]);

    expect(
      buildPortAccessRequestHeaders({
        browserEdgePort: "443",
        browserEdgeProto: "https",
        browserVisibleHost: "p-5173--sandbox.mistle.localhost",
        requestHeaders,
        targetPort: 5173,
      }),
    ).toEqual({
      accept: ["text/html"],
      cookie: ["theme=dark"],
      host: ["127.0.0.1:5173"],
      "x-forwarded-host": ["p-5173--sandbox.mistle.localhost"],
      "x-forwarded-port": ["443"],
      "x-forwarded-proto": ["https"],
      "x-request-marker": ["req-123"],
    });
  });

  it("drops the cookie header when it only contains the port access session cookie", () => {
    const requestHeaders = new Headers([
      ["cookie", "mistle_port_access_session=session-token"],
      ["host", "p-5173--sandbox.mistle.localhost"],
    ]);

    expect(
      buildPortAccessRequestHeaders({
        browserEdgePort: "80",
        browserEdgeProto: "http",
        browserVisibleHost: "p-5173--sandbox.mistle.localhost",
        requestHeaders,
        targetPort: 5173,
      }),
    ).toEqual({
      host: ["127.0.0.1:5173"],
      "x-forwarded-host": ["p-5173--sandbox.mistle.localhost"],
      "x-forwarded-port": ["80"],
      "x-forwarded-proto": ["http"],
    });
  });

  it("builds browser response headers from repeated tunneled header values", () => {
    const responseHeaders = toPortAccessResponseHeaders({
      "cache-control": ["no-store"],
      "set-cookie": ["a=1; Path=/", "b=2; Path=/"],
      vary: ["origin", "accept-encoding"],
    });

    expect(responseHeaders.get("cache-control")).toBe("no-store");
    expect(responseHeaders.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(responseHeaders.get("vary")).toBe("origin, accept-encoding");
  });
});

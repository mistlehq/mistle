import { describe, expect, it } from "vitest";

import {
  createEffectivePublicRequestUrl,
  createMcpProtectedResourceMetadata,
  matchesMcpResourceUrl,
  requireCanonicalMcpResourceUrl,
} from "./protected-resource.js";

describe("createMcpProtectedResourceMetadata", () => {
  it("builds the MCP OAuth protected-resource metadata contract", () => {
    expect(
      createMcpProtectedResourceMetadata({
        mcpResource: "https://mcp.example/mcp",
        authorizationServer: "https://api.example",
      }),
    ).toEqual({
      resource: "https://mcp.example/mcp",
      authorization_servers: ["https://api.example"],
      scopes_supported: [
        "sandboxProfile:read",
        "sandboxProfile:update",
        "sandboxSession:create",
        "sandboxSession:read",
        "sandboxSession:connect",
      ],
      bearer_methods_supported: ["header"],
    });
  });
});

describe("createEffectivePublicRequestUrl", () => {
  it("ignores forwarded headers when they are not trusted", () => {
    const requestUrl = createEffectivePublicRequestUrl({
      requestUrl: "http://api.example/mcp?x=1",
      trustForwardedHeaders: false,
      forwarded: "proto=https;host=mcp.example",
      xForwardedProto: "https",
      xForwardedHost: "mcp.example",
    });

    expect(requestUrl.toString()).toBe("http://api.example/mcp?x=1");
  });

  it("uses the first standard forwarded header entry when trusted", () => {
    const requestUrl = createEffectivePublicRequestUrl({
      requestUrl: "http://api.example/mcp?x=1",
      trustForwardedHeaders: true,
      forwarded: "proto=https;host=mcp.example, proto=http;host=other.example",
      xForwardedProto: "http",
      xForwardedHost: "other.example",
    });

    expect(requestUrl.toString()).toBe("https://mcp.example/mcp?x=1");
  });

  it("uses x-forwarded headers when standard forwarded is absent", () => {
    const requestUrl = createEffectivePublicRequestUrl({
      requestUrl: "http://api.example/mcp?x=1",
      trustForwardedHeaders: true,
      forwarded: null,
      xForwardedProto: "https, http",
      xForwardedHost: "mcp.example, other.example",
    });

    expect(requestUrl.toString()).toBe("https://mcp.example/mcp?x=1");
  });

  it("does not mix standard forwarded and x-forwarded header values", () => {
    expect(() =>
      createEffectivePublicRequestUrl({
        requestUrl: "http://api.example/mcp?x=1",
        trustForwardedHeaders: true,
        forwarded: "proto=https",
        xForwardedProto: "https",
        xForwardedHost: "mcp.example",
      }),
    ).toThrow("Trusted Forwarded header is missing host.");
  });
});

describe("requireCanonicalMcpResourceUrl", () => {
  it("rejects configured MCP URLs with query strings or fragments", () => {
    expect(() =>
      requireCanonicalMcpResourceUrl({
        url: "https://mcp.example/mcp?resource=prod",
        trustForwardedHeaders: false,
        auth: {
          secret: "secret",
          issuer: "issuer",
          audience: "audience",
        },
      }),
    ).toThrow("MCP URL must not include a query string or fragment.");
    expect(() =>
      requireCanonicalMcpResourceUrl({
        url: "https://mcp.example/mcp#fragment",
        trustForwardedHeaders: false,
        auth: {
          secret: "secret",
          issuer: "issuer",
          audience: "audience",
        },
      }),
    ).toThrow("MCP URL must not include a query string or fragment.");
  });
});

describe("matchesMcpResourceUrl", () => {
  it("matches protocol, host including port, and pathname while ignoring query", () => {
    expect(
      matchesMcpResourceUrl({
        requestUrl: new URL("https://mcp.example:8443/mcp?cursor=1"),
        configuredResourceUrl: new URL("https://mcp.example:8443/mcp"),
      }),
    ).toBe(true);
  });

  it("rejects a different host or path", () => {
    expect(
      matchesMcpResourceUrl({
        requestUrl: new URL("https://api.example/mcp"),
        configuredResourceUrl: new URL("https://mcp.example/mcp"),
      }),
    ).toBe(false);
    expect(
      matchesMcpResourceUrl({
        requestUrl: new URL("https://mcp.example/other"),
        configuredResourceUrl: new URL("https://mcp.example/mcp"),
      }),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildTunnelTokenExchangeUrl,
  nextTunnelReconnectDelay,
  nextTunnelTokenExchangeDelay,
  parseGatewayUrl,
  parseTunnelTokenJwtWindow,
  TunnelTokens,
} from "./token-exchange.js";

function makeJwt(issuedAtSeconds: number, expiresAtSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: issuedAtSeconds,
      exp: expiresAtSeconds,
    }),
  ).toString("base64url");

  return `${header}.${payload}.signature`;
}

describe("token exchange helpers", () => {
  it("normalizes the token exchange url from the gateway websocket url", () => {
    expect(buildTunnelTokenExchangeUrl("ws://127.0.0.1:3000/tunnel/sandbox/test")).toBe(
      "http://127.0.0.1:3000/tunnel/sandbox/test/token-exchange",
    );
  });

  it("rejects unsupported gateway schemes", () => {
    expect(() => parseGatewayUrl("http://127.0.0.1:3000/tunnel")).toThrow(
      "sandbox tunnel gateway ws url must use ws or wss scheme",
    );
  });

  it("parses exchange token iat and exp claims", () => {
    const parsedWindow = parseTunnelTokenJwtWindow(makeJwt(100, 200));

    expect(parsedWindow.issuedAt.toISOString()).toBe("1970-01-01T00:01:40.000Z");
    expect(parsedWindow.expiresAt.toISOString()).toBe("1970-01-01T00:03:20.000Z");
  });

  it("computes exchange and reconnect delays", () => {
    const delay = nextTunnelTokenExchangeDelay(
      new Date("1970-01-01T00:00:50.000Z"),
      new Date("1970-01-01T00:00:00.000Z"),
      new Date("1970-01-01T00:01:40.000Z"),
    );

    expect(delay).toBe(30_000);
    expect(nextTunnelReconnectDelay()).toBe(1_000);
  });

  it("stores and replaces tunnel tokens", () => {
    const tokens = new TunnelTokens("bootstrap", makeJwt(100, 200));
    tokens.replace("rotated", makeJwt(200, 300));

    expect(tokens.currentBootstrapToken()).toBe("rotated");
  });
});

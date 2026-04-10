import { randomUUID } from "node:crypto";
import * as http from "node:http";

import { sandboxInstances } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  derivePublishedPortHost,
  mintPublishedPortBootstrapToken,
} from "@mistle/published-port-auth";
import { parsePortsControlMessage } from "@mistle/sandbox-session-protocol";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import { verifyPublishedPortSessionCookieValue } from "../src/publishing/auth/published-port-session.js";
import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForWebSocketMessage,
} from "./websocket-test-helpers.js";

async function insertSandboxInstanceRow(input: {
  sandboxInstanceId: string;
  fixture: DataPlaneGatewayIntegrationFixture;
}): Promise<void> {
  await input.fixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_data_plane_gateway_integration",
    sandboxProfileId: "sbp_data_plane_gateway_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: input.fixture.config.sandbox.provider,
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: "starting",
    startedByKind: "system",
    startedById: "workflow_data_plane_gateway_integration",
    source: "webhook",
  });
}

async function requestGatewayWithHost(input: {
  baseUrl: string;
  host: string;
  path: string;
}): Promise<{
  body: string;
  headers: http.IncomingHttpHeaders;
  status: number;
}> {
  const url = new URL(input.baseUrl);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: url.hostname,
        port: Number(url.port),
        method: "GET",
        path: input.path,
        headers: {
          Host: input.host,
        },
      },
      (response) => {
        const bodyChunks: Uint8Array[] = [];
        response.on("data", (chunk: Uint8Array) => {
          bodyChunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(bodyChunks).toString("utf8"),
          });
        });
      },
    );

    request.on("error", reject);
    request.end();
  });
}

function extractCookieValue(setCookieHeader: string | string[] | undefined, name: string): string {
  const cookieHeaders =
    typeof setCookieHeader === "string" ? [setCookieHeader] : (setCookieHeader ?? []);
  const cookiePrefix = `${name}=`;
  const cookie = cookieHeaders.find((value) => value.startsWith(cookiePrefix));
  if (cookie === undefined) {
    throw new Error(`Expected set-cookie header for '${name}'.`);
  }

  return cookie.slice(cookiePrefix.length).split(";", 1)[0] ?? "";
}

function requireTextMessage(data: string | Buffer): string {
  if (typeof data !== "string") {
    throw new Error("Expected websocket text message.");
  }

  return data;
}

describe("published port bootstrap integration", () => {
  it("bootstraps a published port session after sandbox authorization succeeds", async ({
    fixture,
  }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
    });

    const bootstrapTunnelToken = await mintBootstrapToken({
      config: {
        bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
        tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
        tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId,
      ttlSeconds: 120,
    });
    const bootstrapSocket = await connectSandboxTunnelWebSocket({
      websocketBaseUrl: fixture.websocketBaseUrl,
      sandboxInstanceId,
      tokenKind: "bootstrap",
      token: bootstrapTunnelToken,
    });

    try {
      const host = derivePublishedPortHost({
        config: {
          baseDomain: fixture.config.sandbox.publish.baseDomain,
        },
        sandboxInstanceId,
        port: 5173,
      });
      const bootstrapToken = await mintPublishedPortBootstrapToken({
        config: {
          tokenSecret: fixture.config.sandbox.publish.access.tokenSecret,
          tokenIssuer: fixture.config.sandbox.publish.access.tokenIssuer,
          tokenAudience: fixture.config.sandbox.publish.access.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        port: 5173,
        host,
        ttlSeconds: 120,
      });

      const authorizeMessagePromise = waitForWebSocketMessage(bootstrapSocket);
      const bootstrapResponsePromise = requestGatewayWithHost({
        baseUrl: fixture.baseUrl,
        host,
        path: `/_mistle/bootstrap?token=${encodeURIComponent(bootstrapToken)}`,
      });

      const authorizeMessage = await authorizeMessagePromise;
      expect(authorizeMessage.isBinary).toBe(false);
      const authorizePayload = requireTextMessage(authorizeMessage.data);
      expect(parsePortsControlMessage(authorizePayload)).toEqual({
        type: "ports.target.authorize",
        requestId: expect.any(String),
        target: {
          kind: "port",
          port: 5173,
        },
      });
      const parsedAuthorizeMessage = parsePortsControlMessage(authorizePayload);
      if (
        parsedAuthorizeMessage === undefined ||
        parsedAuthorizeMessage.type !== "ports.target.authorize"
      ) {
        throw new Error("Expected ports.target.authorize request.");
      }

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "ports.target.authorize.result",
          requestId: parsedAuthorizeMessage.requestId,
          authorized: true,
          protocol: "http",
          websocketCapable: true,
        }),
      );

      const bootstrapResponse = await bootstrapResponsePromise;

      expect(bootstrapResponse.status).toBe(302);
      expect(bootstrapResponse.headers.location).toBe("/");
      const cookieValue = extractCookieValue(
        bootstrapResponse.headers["set-cookie"],
        "mistle_published_port_session",
      );
      expect(
        verifyPublishedPortSessionCookieValue({
          cookieSigningSecret: fixture.config.sandbox.publish.session.cookieSigningSecret,
          cookieValue,
        }),
      ).toEqual({
        host,
        sandboxInstanceId,
        port: 5173,
        protocol: "http",
        websocketCapable: true,
        expiresAtEpochSeconds: expect.any(Number),
      });
    } finally {
      await closeWebSocket(bootstrapSocket);
    }
  });

  it("returns a publish failure when sandboxd rejects the port protocol", async ({ fixture }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
    });

    const bootstrapTunnelToken = await mintBootstrapToken({
      config: {
        bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
        tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
        tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId,
      ttlSeconds: 120,
    });
    const bootstrapSocket = await connectSandboxTunnelWebSocket({
      websocketBaseUrl: fixture.websocketBaseUrl,
      sandboxInstanceId,
      tokenKind: "bootstrap",
      token: bootstrapTunnelToken,
    });

    try {
      const host = derivePublishedPortHost({
        config: {
          baseDomain: fixture.config.sandbox.publish.baseDomain,
        },
        sandboxInstanceId,
        port: 3306,
      });
      const bootstrapToken = await mintPublishedPortBootstrapToken({
        config: {
          tokenSecret: fixture.config.sandbox.publish.access.tokenSecret,
          tokenIssuer: fixture.config.sandbox.publish.access.tokenIssuer,
          tokenAudience: fixture.config.sandbox.publish.access.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        port: 3306,
        host,
        ttlSeconds: 120,
      });

      const authorizeMessagePromise = waitForWebSocketMessage(bootstrapSocket);
      const bootstrapResponsePromise = requestGatewayWithHost({
        baseUrl: fixture.baseUrl,
        host,
        path: `/_mistle/bootstrap?token=${encodeURIComponent(bootstrapToken)}`,
      });

      const authorizeMessage = await authorizeMessagePromise;
      const parsedAuthorizeMessage = parsePortsControlMessage(
        requireTextMessage(authorizeMessage.data),
      );
      if (
        parsedAuthorizeMessage === undefined ||
        parsedAuthorizeMessage.type !== "ports.target.authorize"
      ) {
        throw new Error("Expected ports.target.authorize request.");
      }

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "ports.target.authorize.result",
          requestId: parsedAuthorizeMessage.requestId,
          authorized: false,
          reason: "unsupported_protocol",
        }),
      );

      const bootstrapResponse = await bootstrapResponsePromise;

      expect(bootstrapResponse.status).toBe(409);
      expect(JSON.parse(bootstrapResponse.body)).toEqual({
        code: "unsupported_protocol",
        message: "Sandbox port does not speak a supported browser-publish protocol.",
      });
    } finally {
      await closeWebSocket(bootstrapSocket);
    }
  });
});

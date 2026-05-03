/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { derivePortAccessHost, mintPortAccessBootstrapToken } from "@mistle/port-access-auth";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import WebSocket from "ws";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForWebSocketMessage,
} from "../integration/websocket-test-helpers.js";

type GatewayHttpResponse = {
  body: string;
  headers: IncomingHttpHeaders;
  status: number;
};

const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const PortAccessTokenSecret = "integration-new-port-access-secret";
const PortAccessTokenIssuer = "integration-new-control-plane-api";
const PortAccessBaseDomain = "mistle.localhost";
const PortAccessTokenAudience = GatewayTokenAudience;
const TestTimeoutMs = 40_000;

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

describe.concurrent("port access bootstrap integration", () => {
  it(
    "establishes a port access session after sandbox target authorization",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const port = 5173;
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const bootstrap = await mintPortAccessBootstrap({
        sandboxInstanceId,
        port,
      });

      try {
        const responsePromise = sendGatewayHttpRequest({
          env,
          path: createBootstrapPath(bootstrap),
          headers: {
            host: bootstrap.host,
          },
        });

        const authorizeRequest = JSON.parse(
          String((await waitForWebSocketMessage(bootstrapSocket)).data),
        );
        expect(authorizeRequest).toEqual({
          type: "ports.target.authorize",
          requestId: expect.any(String),
          target: {
            kind: "port",
            port,
          },
        });

        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "ports.target.authorize.result",
            requestId: authorizeRequest.requestId,
            authorized: true,
            upstreamProtocol: "http",
            websocketCapable: false,
          }),
        );

        const response = await responsePromise;

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe("/");

        const setCookie = readSetCookieHeader(response);
        expect(setCookie).toContain("mistle_port_access_session=");
        expect(setCookie).toContain("Max-Age=3600");
        expect(setCookie).toContain("Path=/");
        expect(setCookie).toContain("HttpOnly");
        expect(setCookie).toContain("SameSite=Lax");
        expect(setCookie).not.toContain("Domain=");
        expect(setCookie).not.toContain("Secure");
      } finally {
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );

  it("rejects a bootstrap request whose host does not match the signed token", async ({ env }) => {
    const bootstrap = await mintPortAccessBootstrap({
      sandboxInstanceId: typeid("sbi").toString(),
      port: 3000,
    });
    const mismatchedHost = bootstrap.host.replace("p-3000--", "p-3001--");

    const response = await sendGatewayHttpRequest({
      env,
      path: createBootstrapPath(bootstrap),
      headers: {
        host: mismatchedHost,
      },
    });

    expect(response.status).toBe(403);
    expect(response.body).toBe("Port Access host does not match bootstrap token.");
  });

  it("rejects invalid bootstrap tokens", async ({ env }) => {
    const response = await sendGatewayHttpRequest({
      env,
      path: "/_mistle/access/bootstrap?token=not-a-valid-token",
      headers: {
        host: deriveAccessHost({
          sandboxInstanceId: typeid("sbi").toString(),
          port: 5173,
        }),
      },
    });

    expect(response.status).toBe(401);
    expect(response.body).toBe("Invalid or expired Port Access bootstrap token.");
  });

  it("rejects bootstrap requests without the token query parameter", async ({ env }) => {
    const response = await sendGatewayHttpRequest({
      env,
      path: "/_mistle/access/bootstrap",
      headers: {
        host: deriveAccessHost({
          sandboxInstanceId: typeid("sbi").toString(),
          port: 5173,
        }),
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toBe("Port Access bootstrap token query parameter is required.");
  });

  it(
    "returns the sandbox authorization failure reason when the target is unsupported",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const port = 5173;
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const bootstrap = await mintPortAccessBootstrap({
        sandboxInstanceId,
        port,
      });

      try {
        const responsePromise = sendGatewayHttpRequest({
          env,
          path: createBootstrapPath(bootstrap),
          headers: {
            host: bootstrap.host,
          },
        });

        const authorizeRequest = JSON.parse(
          String((await waitForWebSocketMessage(bootstrapSocket)).data),
        );
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "ports.target.authorize.result",
            requestId: authorizeRequest.requestId,
            authorized: false,
            reason: "unsupported_protocol",
          }),
        );

        const response = await responsePromise;

        expect(response.status).toBe(409);
        expect(response.body).toBe("unsupported_protocol");
      } finally {
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );
});

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_integration_new_port_access_bootstrap",
    sandboxProfileId: "sbp_integration_new_port_access_bootstrap",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_new_port_access_bootstrap",
    source: "webhook",
  });
}

function sendGatewayHttpRequest(input: {
  env: IntegrationTestEnvironment;
  path: string;
  headers: Record<string, string>;
}): Promise<GatewayHttpResponse> {
  const url = new URL(input.path, input.env.dataPlaneGateway.hostBaseUrl);

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        headers: {
          ...input.headers,
          [TestEnvironmentIdHeader]: input.env.id,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
        response.on("error", reject);
      },
    );

    request.on("error", reject);
    request.end();
  });
}

async function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return await connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "bootstrap",
    token: await mintBootstrapToken({
      config: {
        bootstrapTokenSecret: BootstrapTokenSecret,
        tokenIssuer: BootstrapTokenIssuer,
        tokenAudience: GatewayTokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: 120,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

async function mintPortAccessBootstrap(input: {
  sandboxInstanceId: string;
  port: number;
}): Promise<{
  host: string;
  token: string;
}> {
  const host = deriveAccessHost(input);

  return {
    host,
    token: await mintPortAccessBootstrapToken({
      config: {
        tokenSecret: PortAccessTokenSecret,
        tokenIssuer: PortAccessTokenIssuer,
        tokenAudience: PortAccessTokenAudience,
      },
      sandboxInstanceId: input.sandboxInstanceId,
      port: input.port,
      host,
      ttlSeconds: 120,
    }),
  };
}

function deriveAccessHost(input: { sandboxInstanceId: string; port: number }): string {
  return derivePortAccessHost({
    config: {
      baseDomain: PortAccessBaseDomain,
    },
    sandboxInstanceId: input.sandboxInstanceId,
    port: input.port,
  });
}

function createBootstrapPath(input: { token: string }): string {
  const url = new URL("/_mistle/access/bootstrap", "http://port-access.test");
  url.searchParams.set("token", input.token);
  return `${url.pathname}${url.search}`;
}

function readSetCookieHeader(response: GatewayHttpResponse): string {
  const header = response.headers["set-cookie"];
  if (header === undefined || header.length === 0) {
    throw new Error("Expected set-cookie header.");
  }

  return header[0];
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}

async function closeIfOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}

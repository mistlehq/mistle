/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { derivePortAccessHost, mintPortAccessBootstrapToken } from "@mistle/port-access-auth";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import WebSocket from "ws";

import {
  connectBootstrapSocket,
  insertSandboxInstanceRow,
  mintValidBootstrapToken,
} from "./runtime-state-test-helpers.js";
import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import {
  closeWebSocket,
  sendWebSocketMessage,
  waitForWebSocketMessage,
} from "./websocket-test-helpers.js";

async function mintPortAccessBootstrap(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  port: number;
  ttlSeconds?: number;
}): Promise<{ host: string; token: string }> {
  const host = derivePortAccessHost({
    config: {
      baseDomain: input.fixture.config.app.sandbox.publish.baseDomain,
    },
    sandboxInstanceId: input.sandboxInstanceId,
    port: input.port,
  });

  return {
    host,
    token: await mintPortAccessBootstrapToken({
      config: input.fixture.config.app.sandbox.publish.access,
      sandboxInstanceId: input.sandboxInstanceId,
      port: input.port,
      host,
      ttlSeconds: input.ttlSeconds ?? 120,
    }),
  };
}

function createBootstrapUrl(input: { token?: string }): string {
  const url = new URL("/_mistle/access/bootstrap", "http://port-access.test");
  if (input.token !== undefined) {
    url.searchParams.set("token", input.token);
  }

  return `${url.pathname}${url.search}`;
}

function extractSetCookieHeader(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (header === null || header.length === 0) {
    throw new Error("Expected set-cookie header.");
  }

  return header;
}

async function closeWebSocketIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
    await closeWebSocket(socket);
  }
}

describe("port access bootstrap integration", () => {
  it("returns 302 and establishes the required session cookie for valid bootstrap", async ({
    fixture,
  }) => {
    const sandboxInstanceId = "sbi_port_access_bootstrap_success";
    const port = 5173;
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
      testId: "port_access_bootstrap_success",
    });
    const bootstrapSocket = await connectBootstrapSocket({
      fixture,
      sandboxInstanceId,
      token: await mintValidBootstrapToken({
        fixture,
        sandboxInstanceId,
      }),
    });
    const { host, token } = await mintPortAccessBootstrap({
      fixture,
      sandboxInstanceId,
      port,
    });

    try {
      const responsePromise = fixture.runtime.request(
        createBootstrapUrl({
          token,
        }),
        {
          headers: {
            host,
          },
          redirect: "manual",
        },
      );

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
      expect(response.headers.get("location")).toBe("/");

      const setCookie = extractSetCookieHeader(response);
      expect(setCookie).toContain("mistle_port_access_session=");
      expect(setCookie).toContain("Max-Age=3600");
      expect(setCookie).toContain("Path=/");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).not.toContain("Domain=");
      expect(setCookie).not.toContain("Secure");
    } finally {
      await closeWebSocketIfOpen(bootstrapSocket);
    }
  });

  it("returns 403 when the request host does not match the bootstrap token host", async ({
    fixture,
  }) => {
    const { host, token } = await mintPortAccessBootstrap({
      fixture,
      sandboxInstanceId: "sbi_port_access_host_mismatch",
      port: 3000,
    });
    const mismatchedHost = host.replace("p-3000--", "p-3001--");

    const response = await fixture.runtime.request(
      createBootstrapUrl({
        token,
      }),
      {
        headers: {
          host: mismatchedHost,
        },
      },
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Port Access host does not match bootstrap token.");
  });

  it("returns 401 for invalid bootstrap tokens", async ({ fixture }) => {
    const response = await fixture.runtime.request(
      createBootstrapUrl({
        token: "not-a-valid-token",
      }),
      {
        headers: {
          host: "p-5173--onrgsx3sn52w4zduojuxaxzqgayq.mistle.example.test",
        },
      },
    );

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Invalid or expired Port Access bootstrap token.");
  });

  it("returns 401 for expired bootstrap tokens", async ({ fixture }) => {
    const { host, token } = await mintPortAccessBootstrap({
      fixture,
      sandboxInstanceId: "sbi_port_access_expired",
      port: 5173,
      ttlSeconds: 1,
    });

    await systemSleeper.sleep(1_100);

    const response = await fixture.runtime.request(
      createBootstrapUrl({
        token,
      }),
      {
        headers: {
          host,
        },
      },
    );

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("Invalid or expired Port Access bootstrap token.");
  });

  it("returns 400 when the bootstrap token query parameter is missing", async ({ fixture }) => {
    const response = await fixture.runtime.request(createBootstrapUrl({}), {
      headers: {
        host: "p-5173--onrgsx3sn52w4zduojuxaxzqgayq.mistle.example.test",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      "Port Access bootstrap token query parameter is required.",
    );
  });

  it("returns 409 when sandboxd rejects the target as unsupported", async ({ fixture }) => {
    const sandboxInstanceId = "sbi_port_access_unsupported";
    const port = 5173;
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
      testId: "port_access_unsupported",
    });
    const bootstrapSocket = await connectBootstrapSocket({
      fixture,
      sandboxInstanceId,
      token: await mintValidBootstrapToken({
        fixture,
        sandboxInstanceId,
      }),
    });
    const { host, token } = await mintPortAccessBootstrap({
      fixture,
      sandboxInstanceId,
      port,
    });

    try {
      const responsePromise = fixture.runtime.request(
        createBootstrapUrl({
          token,
        }),
        {
          headers: {
            host,
          },
        },
      );

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
      await expect(response.text()).resolves.toBe("unsupported_protocol");
    } finally {
      await closeWebSocketIfOpen(bootstrapSocket);
    }
  });

  it("returns 502 when target authorization times out", async ({ fixture }) => {
    const sandboxInstanceId = "sbi_port_access_timeout";
    const port = 5173;
    await insertSandboxInstanceRow({
      fixture,
      sandboxInstanceId,
      testId: "port_access_timeout",
    });
    const bootstrapSocket = await connectBootstrapSocket({
      fixture,
      sandboxInstanceId,
      token: await mintValidBootstrapToken({
        fixture,
        sandboxInstanceId,
      }),
    });
    const { host, token } = await mintPortAccessBootstrap({
      fixture,
      sandboxInstanceId,
      port,
    });

    try {
      const responsePromise = fixture.runtime.request(
        createBootstrapUrl({
          token,
        }),
        {
          headers: {
            host,
          },
        },
      );

      await waitForWebSocketMessage(bootstrapSocket);

      const response = await responsePromise;
      expect(response.status).toBe(502);
      await expect(response.text()).resolves.toBe("Port Access authorization failed.");
    } finally {
      await closeWebSocketIfOpen(bootstrapSocket);
    }
  });
});

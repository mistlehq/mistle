/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import {
  derivePublishedTargetHost,
  mintPublishedTargetAccessToken,
  mintPublishedTargetShareToken,
} from "@mistle/published-target-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { parsePublishControlMessage } from "@mistle/sandbox-session-protocol";
import { describe, expect } from "vitest";

import {
  PublishedTargetRequestCookieError,
  verifyPublishedTargetSessionFromCookieHeader,
} from "../src/publishing/auth/published-target-session-cookie.js";
import { insertSandboxInstanceRow } from "./runtime-state-test-helpers.js";
import { it } from "./test-context.js";
import type { DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForWebSocketMessage,
} from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 30_000;

function createBootstrapToken(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<string> {
  return mintBootstrapToken({
    config: {
      bootstrapTokenSecret: input.fixture.config.sandbox.bootstrap.tokenSecret,
      tokenAudience: input.fixture.config.sandbox.bootstrap.tokenAudience,
      tokenIssuer: input.fixture.config.sandbox.bootstrap.tokenIssuer,
    },
    jti: randomUUID(),
    sandboxInstanceId: input.sandboxInstanceId,
    ttlSeconds: 120,
  });
}

function createPublishedHost(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  port: number;
}): string {
  return derivePublishedTargetHost({
    baseDomain: input.fixture.config.sandbox.publish.baseDomain,
    sandboxInstanceId: input.sandboxInstanceId,
    target: {
      kind: "port",
      port: input.port,
    },
  });
}

function createPublishedTargetUrl(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  host: string;
  path: string;
}): URL {
  const url = new URL(input.path, input.fixture.baseUrl);
  url.hostname = input.host;
  return url;
}

async function expectAuthorizeRequest(input: {
  bootstrapSocket: Awaited<ReturnType<typeof connectSandboxTunnelWebSocket>>;
  expectedPort: number;
}) {
  const controlMessage = parsePublishControlMessage(
    String((await waitForWebSocketMessage(input.bootstrapSocket)).data),
  );
  if (controlMessage?.type !== "publish.target.authorize") {
    throw new Error("Expected bootstrap peer to receive publish.target.authorize.");
  }

  expect(controlMessage.target).toEqual({
    kind: "port",
    port: input.expectedPort,
  });

  return controlMessage;
}

describe("published target bootstrap integration", () => {
  it(
    "bootstraps an owned published-target session and sets a host-scoped cookie",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_bootstrap_001";
      const host = createPublishedHost({
        fixture,
        sandboxInstanceId,
        port: 5173,
      });
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_bootstrap_owned",
      });

      const bootstrapSocket = await connectSandboxTunnelWebSocket({
        sandboxInstanceId,
        token: await createBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
        tokenKind: "bootstrap",
        websocketBaseUrl: fixture.websocketBaseUrl,
      });

      try {
        const token = await mintPublishedTargetAccessToken({
          config: fixture.config.sandbox.publish.access,
          host,
          jti: randomUUID(),
          organizationId: "org_publish_bootstrap",
          sandboxInstanceId,
          targetId: "5173",
          targetKind: "port",
          ttlSeconds: 300,
          userId: "usr_publish_bootstrap",
        });

        const responsePromise = fetch(
          createPublishedTargetUrl({
            fixture,
            host,
            path: `/_mistle/bootstrap?token=${encodeURIComponent(token)}`,
          }),
          {
            redirect: "manual",
          },
        );

        const authorizeRequest = await expectAuthorizeRequest({
          bootstrapSocket,
          expectedPort: 5173,
        });
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "publish.target.authorize.result",
            requestId: authorizeRequest.requestId,
            authorized: true,
          }),
        );

        const response = await responsePromise;
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe("/");

        const setCookieHeader = response.headers.get("set-cookie");
        expect(setCookieHeader).not.toBeNull();
        if (setCookieHeader === null) {
          throw new Error("Expected bootstrap response to include set-cookie.");
        }

        expect(
          verifyPublishedTargetSessionFromCookieHeader({
            config: fixture.config.sandbox.publish.session,
            cookieHeader: setCookieHeader,
            expectedHost: host,
          }),
        ).toEqual({
          host,
          organizationId: "org_publish_bootstrap",
          sandboxInstanceId,
          sessionKind: "owned",
          targetId: "5173",
          targetKind: "port",
          userId: "usr_publish_bootstrap",
        });
      } finally {
        await closeWebSocket(bootstrapSocket);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "bootstraps a shared published-target session and sets a shared cookie",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_bootstrap_002";
      const host = createPublishedHost({
        fixture,
        sandboxInstanceId,
        port: 4173,
      });
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_bootstrap_shared",
      });

      const bootstrapSocket = await connectSandboxTunnelWebSocket({
        sandboxInstanceId,
        token: await createBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
        tokenKind: "bootstrap",
        websocketBaseUrl: fixture.websocketBaseUrl,
      });

      try {
        const token = await mintPublishedTargetShareToken({
          config: fixture.config.sandbox.publish.access,
          host,
          jti: randomUUID(),
          sandboxInstanceId,
          targetId: "4173",
          targetKind: "port",
          ttlSeconds: 900,
        });

        const responsePromise = fetch(
          createPublishedTargetUrl({
            fixture,
            host,
            path: `/_mistle/share?token=${encodeURIComponent(token)}`,
          }),
          {
            redirect: "manual",
          },
        );

        const authorizeRequest = await expectAuthorizeRequest({
          bootstrapSocket,
          expectedPort: 4173,
        });
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "publish.target.authorize.result",
            requestId: authorizeRequest.requestId,
            authorized: true,
          }),
        );

        const response = await responsePromise;
        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe("/");

        const setCookieHeader = response.headers.get("set-cookie");
        expect(setCookieHeader).not.toBeNull();
        if (setCookieHeader === null) {
          throw new Error("Expected share bootstrap response to include set-cookie.");
        }

        expect(
          verifyPublishedTargetSessionFromCookieHeader({
            config: fixture.config.sandbox.publish.session,
            cookieHeader: setCookieHeader,
            expectedHost: host,
          }),
        ).toEqual({
          host,
          sandboxInstanceId,
          sessionKind: "shared",
          targetId: "4173",
          targetKind: "port",
        });
      } finally {
        await closeWebSocket(bootstrapSocket);
      }
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects a published-target session cookie on a different host",
    async ({ fixture }) => {
      const sandboxInstanceId = "sbi_publish_bootstrap_003";
      const originalHost = createPublishedHost({
        fixture,
        sandboxInstanceId,
        port: 3000,
      });
      const differentHost = createPublishedHost({
        fixture,
        sandboxInstanceId: "sbi_publish_bootstrap_004",
        port: 3000,
      });
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        testId: "publish_bootstrap_cookie",
      });

      const bootstrapSocket = await connectSandboxTunnelWebSocket({
        sandboxInstanceId,
        token: await createBootstrapToken({
          fixture,
          sandboxInstanceId,
        }),
        tokenKind: "bootstrap",
        websocketBaseUrl: fixture.websocketBaseUrl,
      });

      try {
        const token = await mintPublishedTargetAccessToken({
          config: fixture.config.sandbox.publish.access,
          host: originalHost,
          jti: randomUUID(),
          organizationId: "org_publish_cookie",
          sandboxInstanceId,
          targetId: "3000",
          targetKind: "port",
          ttlSeconds: 300,
          userId: "usr_publish_cookie",
        });

        const responsePromise = fetch(
          createPublishedTargetUrl({
            fixture,
            host: originalHost,
            path: `/_mistle/bootstrap?token=${encodeURIComponent(token)}`,
          }),
          {
            redirect: "manual",
          },
        );

        const authorizeRequest = await expectAuthorizeRequest({
          bootstrapSocket,
          expectedPort: 3000,
        });
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "publish.target.authorize.result",
            requestId: authorizeRequest.requestId,
            authorized: true,
          }),
        );

        const response = await responsePromise;
        const setCookieHeader = response.headers.get("set-cookie");
        if (setCookieHeader === null) {
          throw new Error("Expected bootstrap response to include set-cookie.");
        }

        expect(() =>
          verifyPublishedTargetSessionFromCookieHeader({
            config: fixture.config.sandbox.publish.session,
            cookieHeader: setCookieHeader,
            expectedHost: differentHost,
          }),
        ).toThrow(PublishedTargetRequestCookieError);
      } finally {
        await closeWebSocket(bootstrapSocket);
      }
    },
    IntegrationTestTimeoutMs,
  );
});

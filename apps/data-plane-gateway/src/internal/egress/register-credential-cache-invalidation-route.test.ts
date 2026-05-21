import { Cache, InMemoryCacheAdapter } from "@mistle/cache";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { CredentialCache } from "../../egress/credential-cache.js";
import type { AppContextBindings, DataPlaneGatewayApp } from "../../types.js";
import { registerCredentialCacheInvalidationRoute } from "./register-credential-cache-invalidation-route.js";

const InternalServiceToken = "test-internal-service-token";
const NowMs = Date.parse("2026-05-21T00:00:00.000Z");

function createTestApp(): {
  app: DataPlaneGatewayApp;
  credentialCache: CredentialCache;
} {
  const app = new Hono<AppContextBindings>();
  const credentialCache = new CredentialCache({
    cache: new Cache({
      adapter: new InMemoryCacheAdapter(),
    }),
    defaultTtlSeconds: 300,
    refreshSkewSeconds: 30,
    now: () => NowMs,
  });

  registerCredentialCacheInvalidationRoute({
    app,
    credentialCache,
    internalAuthServiceToken: InternalServiceToken,
  });

  return {
    app,
    credentialCache,
  };
}

describe("registerCredentialCacheInvalidationRoute", () => {
  it("rejects requests without the internal service token", async () => {
    const { app } = createTestApp();

    const response = await app.request("/internal/egress/credential-cache/invalidate", {
      method: "POST",
      body: JSON.stringify({
        connectionId: "icn_test",
      }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("invalidates cached credentials for the requested connection", async () => {
    const { app, credentialCache } = createTestApp();
    await credentialCache.set(
      {
        bindingId: "bind_test",
        credentialResolverKind: "integration_connection",
        connectionId: "icn_test",
        secretType: "oauth2_access_token",
        slotKey: "github_default.oauth2.access_token",
      },
      {
        kind: "value",
        value: "old-token",
      },
    );

    const response = await app.request("/internal/egress/credential-cache/invalidate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mistle-service-token": InternalServiceToken,
      },
      body: JSON.stringify({
        connectionId: "icn_test",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      deletedEntryCount: 1,
    });
  });
});

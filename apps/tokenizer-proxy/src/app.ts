import { Hono } from "hono";

import { ControlPlaneCredentialResolverClient } from "./egress/control-plane-client.js";
import { CredentialCache } from "./egress/credential-cache.js";
import { createEgressProxyHandler, EGRESS_ROUTE_BASE_PATH } from "./egress/proxy-handler.js";
import type { AppContextBindings, TokenizerProxyApp, TokenizerProxyConfig } from "./types.js";

export function createApp(
  config: TokenizerProxyConfig,
  internalAuthServiceToken: string,
): TokenizerProxyApp {
  const app = new Hono<AppContextBindings>();
  const controlPlaneCredentialResolverClient = new ControlPlaneCredentialResolverClient({
    baseUrl: config.controlPlaneApi.baseUrl,
    internalAuthServiceToken,
    requestTimeoutMs: config.credentialResolver.requestTimeoutMs,
  });
  const credentialCache = new CredentialCache({
    maxEntries: config.cache.maxEntries,
    defaultTtlSeconds: config.cache.defaultTtlSeconds,
    refreshSkewSeconds: config.cache.refreshSkewSeconds,
    now: () => Date.now(),
  });
  const egressProxyHandler = createEgressProxyHandler({
    controlPlaneCredentialResolverClient,
    credentialCache,
  });

  app.use("*", async (ctx, next) => {
    ctx.set("config", config);
    ctx.set("internalAuthServiceToken", internalAuthServiceToken);
    await next();
  });

  app.get("/__healthz", (ctx) => {
    return ctx.json({ ok: true });
  });

  app.all(EGRESS_ROUTE_BASE_PATH, egressProxyHandler);

  return app;
}

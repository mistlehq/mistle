import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { Hono } from "hono";

import {
  EGRESS_BASE_PATH,
  EGRESS_WILDCARD_BASE_PATH,
  CREDENTIAL_CACHE_DEFAULT_TTL_SECONDS,
  CREDENTIAL_CACHE_MAX_ENTRIES,
  CREDENTIAL_CACHE_REFRESH_SKEW_SECONDS,
  CREDENTIAL_RESOLVER_REQUEST_TIMEOUT_MS,
} from "./egress/constants.js";
import { CredentialCache } from "./egress/credential-cache.js";
import { createEgressProxyHandler } from "./egress/proxy-handler.js";
import { createEgressProxyUpgradeHandler } from "./egress/upgrade-handler.js";
import type {
  AppContextBindings,
  TokenizerProxyApp,
  TokenizerProxyConfig,
  TokenizerProxyUpgradeHandler,
} from "./types.js";

type TokenizerProxyAppComponents = {
  app: TokenizerProxyApp;
  onUpgrade: TokenizerProxyUpgradeHandler;
};

export function createAppComponents(
  config: TokenizerProxyConfig,
  internalAuthServiceToken: string,
): TokenizerProxyAppComponents {
  const app = new Hono<AppContextBindings>();
  const controlPlaneInternalClient = new ControlPlaneInternalClient({
    baseUrl: config.controlPlaneApi.baseUrl,
    internalAuthServiceToken,
    requestTimeoutMs: CREDENTIAL_RESOLVER_REQUEST_TIMEOUT_MS,
  });
  const credentialCache = new CredentialCache({
    maxEntries: CREDENTIAL_CACHE_MAX_ENTRIES,
    defaultTtlSeconds: CREDENTIAL_CACHE_DEFAULT_TTL_SECONDS,
    refreshSkewSeconds: CREDENTIAL_CACHE_REFRESH_SKEW_SECONDS,
    now: () => Date.now(),
  });
  const egressProxyHandler = createEgressProxyHandler({
    controlPlaneInternalClient,
    credentialCache,
  });
  const egressProxyUpgradeHandler = createEgressProxyUpgradeHandler({
    controlPlaneInternalClient,
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

  app.all(EGRESS_BASE_PATH, egressProxyHandler);
  app.all(EGRESS_WILDCARD_BASE_PATH, egressProxyHandler);

  return {
    app,
    onUpgrade: egressProxyUpgradeHandler,
  };
}

export function createApp(
  config: TokenizerProxyConfig,
  internalAuthServiceToken: string,
): TokenizerProxyApp {
  return createAppComponents(config, internalAuthServiceToken).app;
}

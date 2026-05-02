import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { resolveIntegrationEgressCredentialResolver } from "@mistle/integrations-definitions/server";
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

export function createAppComponents(config: TokenizerProxyConfig): TokenizerProxyAppComponents {
  const app = new Hono<AppContextBindings>();
  const controlPlaneInternalClient = new ControlPlaneInternalClient({
    baseUrl: config.controlPlaneApi.baseUrl,
    internalAuthServiceToken: config.internalAuth.serviceToken,
    requestTimeoutMs: CREDENTIAL_RESOLVER_REQUEST_TIMEOUT_MS,
    ...(config.__dangerouslyEnableTestIsolation === undefined
      ? {}
      : {
          testEnvironmentIdHeader: config.__dangerouslyEnableTestIsolation.testEnvironmentIdHeader,
        }),
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
    egressGrantConfig: config.egressGrant,
    resolveEgressCredentialResolver: resolveIntegrationEgressCredentialResolver,
  });
  const egressProxyUpgradeHandler = createEgressProxyUpgradeHandler({
    controlPlaneInternalClient,
    credentialCache,
    egressGrantConfig: config.egressGrant,
    ...(config.__dangerouslyEnableTestIsolation === undefined
      ? {}
      : {
          testEnvironmentIdHeader: config.__dangerouslyEnableTestIsolation.testEnvironmentIdHeader,
        }),
  });

  app.get("/__healthz", (ctx) => {
    return ctx.json({ ok: true });
  });

  app.use("*", async (ctx, next) => {
    const testEnvironmentId = readTestEnvironmentId(config, (name) => ctx.req.header(name));
    ctx.set("config", config);
    ctx.set("internalAuthServiceToken", config.internalAuth.serviceToken);
    if (testEnvironmentId !== undefined) {
      ctx.set("testEnvironmentId", testEnvironmentId);
    }
    await next();
  });

  app.all(EGRESS_BASE_PATH, egressProxyHandler);
  app.all(EGRESS_WILDCARD_BASE_PATH, egressProxyHandler);

  return {
    app,
    onUpgrade: egressProxyUpgradeHandler,
  };
}

export function createApp(config: TokenizerProxyConfig): TokenizerProxyApp {
  return createAppComponents(config).app;
}

function readTestEnvironmentId(
  config: TokenizerProxyConfig,
  readHeader: (name: string) => string | undefined,
): string | undefined {
  const testIsolation = config.__dangerouslyEnableTestIsolation;
  if (testIsolation === undefined) {
    return undefined;
  }

  const testEnvironmentId = readHeader(testIsolation.testEnvironmentIdHeader);
  if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
    throw new Error(
      `Expected '${testIsolation.testEnvironmentIdHeader}' header for isolated tokenizer-proxy request.`,
    );
  }

  return testEnvironmentId;
}

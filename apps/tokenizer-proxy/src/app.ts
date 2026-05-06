import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { resolveIntegrationEgressCredentialResolver } from "@mistle/integrations-definitions/server";
import { Hono } from "hono";

import {
  EGRESS_BASE_PATH,
  EGRESS_WILDCARD_BASE_PATH,
  TEST_ENVIRONMENT_EGRESS_BASE_PATH_PATTERN,
  TEST_ENVIRONMENT_EGRESS_BASE_PATH_PREFIX,
  TEST_ENVIRONMENT_EGRESS_WILDCARD_BASE_PATH_PATTERN,
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
    const testEnvironmentId = readTestEnvironmentId(config, {
      readHeader: (name) => ctx.req.header(name),
      readQuery: (name) => ctx.req.query(name),
      requestPath: ctx.req.path,
    });
    ctx.set("config", config);
    ctx.set("internalAuthServiceToken", config.internalAuth.serviceToken);
    if (testEnvironmentId !== undefined) {
      ctx.set("testEnvironmentId", testEnvironmentId);
    }
    await next();
  });

  app.all(EGRESS_BASE_PATH, egressProxyHandler);
  app.all(EGRESS_WILDCARD_BASE_PATH, egressProxyHandler);
  if (config.__dangerouslyEnableTestIsolation !== undefined) {
    app.all(TEST_ENVIRONMENT_EGRESS_BASE_PATH_PATTERN, egressProxyHandler);
    app.all(TEST_ENVIRONMENT_EGRESS_WILDCARD_BASE_PATH_PATTERN, egressProxyHandler);
  }

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
  input: {
    readHeader: (name: string) => string | undefined;
    readQuery: (name: string) => string | undefined;
    requestPath: string;
  },
): string | undefined {
  const testIsolation = config.__dangerouslyEnableTestIsolation;
  if (testIsolation === undefined) {
    return undefined;
  }

  const testEnvironmentId =
    input.readHeader(testIsolation.testEnvironmentIdHeader) ??
    input.readQuery(testIsolation.testEnvironmentIdHeader) ??
    readTestEnvironmentIdFromPath(input.requestPath);
  if (testEnvironmentId === undefined || testEnvironmentId.length === 0) {
    throw new Error(
      `Expected '${testIsolation.testEnvironmentIdHeader}' header, query parameter, or path prefix for isolated tokenizer-proxy request.`,
    );
  }

  return testEnvironmentId;
}

function readTestEnvironmentIdFromPath(requestPath: string): string | undefined {
  const prefix = `${TEST_ENVIRONMENT_EGRESS_BASE_PATH_PREFIX}/`;
  if (!requestPath.startsWith(prefix)) {
    return undefined;
  }

  const pathWithoutPrefix = requestPath.slice(prefix.length);
  const separatorIndex = pathWithoutPrefix.indexOf("/");
  if (separatorIndex <= 0) {
    return undefined;
  }

  return decodeURIComponent(pathWithoutPrefix.slice(0, separatorIndex));
}

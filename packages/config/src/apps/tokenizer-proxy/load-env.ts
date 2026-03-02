import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  type PartialTokenizerProxyConfigInput,
  PartialTokenizerProxyConfigSchema,
  TokenizerProxyCacheConfigSchema,
  TokenizerProxyControlPlaneApiConfigSchema,
  TokenizerProxyCredentialResolverConfigSchema,
  TokenizerProxyServerConfigSchema,
} from "./schema.js";

const loadServerEnv = createEnvLoader<typeof TokenizerProxyServerConfigSchema>([
  {
    key: "host",
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_HOST",
  },
  {
    key: "port",
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_PORT",
    parse: Number,
  },
]);

const loadControlPlaneApiEnv = createEnvLoader<typeof TokenizerProxyControlPlaneApiConfigSchema>([
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_BASE_URL",
  },
]);

const loadCredentialResolverEnv = createEnvLoader<
  typeof TokenizerProxyCredentialResolverConfigSchema
>([
  {
    key: "requestTimeoutMs",
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_CREDENTIAL_RESOLVER_REQUEST_TIMEOUT_MS",
    parse: Number,
  },
]);

const loadCacheEnv = createEnvLoader<typeof TokenizerProxyCacheConfigSchema>([
  {
    key: "maxEntries",
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_CACHE_MAX_ENTRIES",
    parse: Number,
  },
  {
    key: "defaultTtlSeconds",
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_CACHE_DEFAULT_TTL_SECONDS",
    parse: Number,
  },
  {
    key: "refreshSkewSeconds",
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_CACHE_REFRESH_SKEW_SECONDS",
    parse: Number,
  },
]);

export function loadTokenizerProxyFromEnv(
  env: NodeJS.ProcessEnv,
): PartialTokenizerProxyConfigInput {
  const partialConfig: PartialTokenizerProxyConfigInput = {};

  const server = loadServerEnv(env);
  if (hasEntries(server)) {
    partialConfig.server = server;
  }

  const controlPlaneApi = loadControlPlaneApiEnv(env);
  if (hasEntries(controlPlaneApi)) {
    partialConfig.controlPlaneApi = controlPlaneApi;
  }

  const credentialResolver = loadCredentialResolverEnv(env);
  if (hasEntries(credentialResolver)) {
    partialConfig.credentialResolver = credentialResolver;
  }

  const cache = loadCacheEnv(env);
  if (hasEntries(cache)) {
    partialConfig.cache = cache;
  }

  return PartialTokenizerProxyConfigSchema.parse(partialConfig);
}

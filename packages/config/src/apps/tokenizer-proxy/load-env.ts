import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  type PartialTokenizerProxyConfigInput,
  PartialTokenizerProxyConfigSchema,
  TokenizerProxyControlPlaneApiConfigSchema,
  TokenizerProxyServerConfigSchema,
} from "./schema.js";

export const TokenizerProxyServerEnvDescriptors = [
  {
    key: "host",
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_HOST",
  },
  {
    key: "port",
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_PORT",
    parse: Number,
  },
] satisfies Parameters<typeof createEnvLoader<typeof TokenizerProxyServerConfigSchema>>[0];

export const TokenizerProxyControlPlaneApiEnvDescriptors = [
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_BASE_URL",
  },
  {
    key: "publicBaseUrl",
    envVar: "MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_PUBLIC_BASE_URL",
  },
] satisfies Parameters<typeof createEnvLoader<typeof TokenizerProxyControlPlaneApiConfigSchema>>[0];

const loadServerEnv = createEnvLoader<typeof TokenizerProxyServerConfigSchema>(
  TokenizerProxyServerEnvDescriptors,
);
const loadControlPlaneApiEnv = createEnvLoader<typeof TokenizerProxyControlPlaneApiConfigSchema>(
  TokenizerProxyControlPlaneApiEnvDescriptors,
);

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

  return PartialTokenizerProxyConfigSchema.parse(partialConfig);
}

import { createEnvLoader, hasEntries } from "../../core/load-env.js";
import {
  type PartialTokenizerProxyConfigInput,
  PartialTokenizerProxyConfigSchema,
  TokenizerProxyControlPlaneApiConfigSchema,
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

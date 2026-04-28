import { createEnvLoader } from "../../core/load-env.js";
import {
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

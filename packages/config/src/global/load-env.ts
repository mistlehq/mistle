import { createEnvLoader, hasEntries } from "../core/load-env.js";
import {
  GlobalConnectionTokensConfigSchema,
  type PartialGlobalConfigInput,
  GlobalConfigSchema,
  GlobalTunnelConfigSchema,
} from "./schema.js";

const loadGlobalEnv = createEnvLoader<typeof GlobalConfigSchema>([
  {
    key: "env",
    envVar: "NODE_ENV",
    parse: (value) => (value === "production" ? "production" : "development"),
  },
  {
    key: "internalAuth",
    envVar: "MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN",
    parse: (value) => ({
      serviceToken: value,
    }),
  },
]);

const loadTunnelEnv = createEnvLoader<typeof GlobalTunnelConfigSchema>([
  {
    key: "bootstrapTokenSecret",
    envVar: "MISTLE_GLOBAL_TUNNEL_BOOTSTRAP_TOKEN_SECRET",
  },
  {
    key: "tokenIssuer",
    envVar: "MISTLE_GLOBAL_TUNNEL_TOKEN_ISSUER",
  },
  {
    key: "tokenAudience",
    envVar: "MISTLE_GLOBAL_TUNNEL_TOKEN_AUDIENCE",
  },
]);

const loadConnectionTokensEnv = createEnvLoader<typeof GlobalConnectionTokensConfigSchema>([
  {
    key: "secret",
    envVar: "MISTLE_GLOBAL_CONNECTION_TOKENS_SECRET",
  },
  {
    key: "issuer",
    envVar: "MISTLE_GLOBAL_CONNECTION_TOKENS_ISSUER",
  },
  {
    key: "audience",
    envVar: "MISTLE_GLOBAL_CONNECTION_TOKENS_AUDIENCE",
  },
]);

export function loadGlobalFromEnv(env: NodeJS.ProcessEnv): PartialGlobalConfigInput {
  const partialGlobal = loadGlobalEnv(env);
  const partialTunnel = loadTunnelEnv(env);
  const partialConnectionTokens = loadConnectionTokensEnv(env);

  if (hasEntries(partialTunnel)) {
    partialGlobal.tunnel = partialTunnel;
  }
  if (hasEntries(partialConnectionTokens)) {
    partialGlobal.connectionTokens = partialConnectionTokens;
  }

  return GlobalConfigSchema.partial().parse(partialGlobal);
}

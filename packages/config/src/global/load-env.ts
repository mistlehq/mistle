import { createEnvLoader, hasEntries } from "../core/load-env.js";
import {
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

export function loadGlobalFromEnv(env: NodeJS.ProcessEnv): PartialGlobalConfigInput {
  const partialGlobal = loadGlobalEnv(env);
  const partialTunnel = loadTunnelEnv(env);

  if (hasEntries(partialTunnel)) {
    partialGlobal.tunnel = partialTunnel;
  }

  return GlobalConfigSchema.partial().parse(partialGlobal);
}

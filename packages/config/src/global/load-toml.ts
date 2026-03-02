import { asObjectRecord } from "../core/record.js";
import { type PartialGlobalConfigInput, GlobalConfigSchema } from "./schema.js";

export function loadGlobalFromToml(tomlRoot: Record<string, unknown>): PartialGlobalConfigInput {
  const global = asObjectRecord(tomlRoot.global);
  const internalAuth = asObjectRecord(global.internal_auth);
  const tunnel = asObjectRecord(global.tunnel);
  const connectionTokens = asObjectRecord(global.connection_tokens);

  return GlobalConfigSchema.partial().parse({
    env: global.env,
    ...(typeof internalAuth.service_token === "string"
      ? {
          internalAuth: {
            serviceToken: internalAuth.service_token,
          },
        }
      : {}),
    ...(typeof tunnel.bootstrap_token_secret === "string"
      ? {
          tunnel: {
            bootstrapTokenSecret: tunnel.bootstrap_token_secret,
            tokenIssuer: tunnel.token_issuer,
            tokenAudience: tunnel.token_audience,
          },
        }
      : {}),
    ...(typeof connectionTokens.secret === "string"
      ? {
          connectionTokens: {
            secret: connectionTokens.secret,
            issuer: connectionTokens.issuer,
            audience: connectionTokens.audience,
          },
        }
      : {}),
  });
}

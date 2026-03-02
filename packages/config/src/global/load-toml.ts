import { asObjectRecord } from "../core/record.js";
import { type PartialGlobalConfigInput, GlobalConfigSchema } from "./schema.js";

export function loadGlobalFromToml(tomlRoot: Record<string, unknown>): PartialGlobalConfigInput {
  const global = asObjectRecord(tomlRoot.global);
  const internalAuth = asObjectRecord(global.internal_auth);
  const sandbox = asObjectRecord(global.sandbox);
  const sandboxBootstrap = asObjectRecord(sandbox.bootstrap);
  const sandboxConnect = asObjectRecord(sandbox.connect);

  return GlobalConfigSchema.partial().parse({
    env: global.env,
    ...(typeof internalAuth.service_token === "string"
      ? {
          internalAuth: {
            serviceToken: internalAuth.service_token,
          },
        }
      : {}),
    ...(typeof sandboxBootstrap.token_secret === "string" ||
    typeof sandboxConnect.token_secret === "string"
      ? {
          sandbox: {
            bootstrap: {
              tokenSecret: sandboxBootstrap.token_secret,
              tokenIssuer: sandboxBootstrap.token_issuer,
              tokenAudience: sandboxBootstrap.token_audience,
            },
            connect: {
              tokenSecret: sandboxConnect.token_secret,
              tokenIssuer: sandboxConnect.token_issuer,
              tokenAudience: sandboxConnect.token_audience,
            },
          },
        }
      : {}),
  });
}

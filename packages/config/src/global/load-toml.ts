import { asObjectRecord } from "../core/record.js";
import { type PartialGlobalConfigInput, GlobalConfigSchema } from "./schema.js";

export function loadGlobalFromToml(tomlRoot: Record<string, unknown>): PartialGlobalConfigInput {
  const global = asObjectRecord(tomlRoot.global);
  const internalAuth = asObjectRecord(global.internal_auth);

  return GlobalConfigSchema.partial().parse({
    env: global.env,
    ...(typeof internalAuth.service_token === "string"
      ? {
          internalAuth: {
            serviceToken: internalAuth.service_token,
          },
        }
      : {}),
  });
}

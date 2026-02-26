import { createEnvLoader } from "../core/load-env.js";
import { type PartialGlobalConfigInput, GlobalConfigSchema } from "./schema.js";

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

export function loadGlobalFromEnv(env: NodeJS.ProcessEnv): PartialGlobalConfigInput {
  return GlobalConfigSchema.partial().parse(loadGlobalEnv(env));
}

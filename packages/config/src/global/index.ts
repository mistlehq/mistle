import type { ConfigModule } from "../core/module.js";
import { loadGlobalFromEnv } from "./load-env.js";
import { GlobalConfigSchema } from "./schema.js";

export { loadGlobalFromEnv } from "./load-env.js";
export { GlobalConfigSchema } from "./schema.js";

export const globalConfigModule: ConfigModule<typeof GlobalConfigSchema> = {
  namespace: ["global"],
  schema: GlobalConfigSchema,
  loadEnv: loadGlobalFromEnv,
};

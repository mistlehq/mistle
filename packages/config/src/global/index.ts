import { loadGlobalFromEnv } from "./load-env.js";
import { GlobalConfigSchema } from "./schema.js";

export { loadGlobalFromEnv } from "./load-env.js";
export { GlobalConfigSchema } from "./schema.js";

export const globalConfigModule = {
  schema: GlobalConfigSchema,
  loadEnv: loadGlobalFromEnv,
};

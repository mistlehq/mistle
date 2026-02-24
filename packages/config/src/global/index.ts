import type { ConfigModule } from "../core/module.js";

import { loadGlobalFromEnv } from "./load-env.js";
import { loadGlobalFromToml } from "./load-toml.js";
import { GlobalConfigSchema } from "./schema.js";

export { loadGlobalFromEnv } from "./load-env.js";
export { loadGlobalFromToml } from "./load-toml.js";
export { GlobalConfigSchema } from "./schema.js";

export const globalConfigModule: ConfigModule<typeof GlobalConfigSchema> = {
  namespace: ["global"],
  schema: GlobalConfigSchema,
  loadToml: loadGlobalFromToml,
  loadEnv: loadGlobalFromEnv,
};

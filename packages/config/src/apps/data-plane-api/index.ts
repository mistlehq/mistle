import type { ConfigModule } from "../../core/module.js";
import { loadDataPlaneApiFromEnv } from "./load-env.js";
import { loadDataPlaneApiFromToml } from "./load-toml.js";
import { DataPlaneApiConfigSchema } from "./schema.js";

export { loadDataPlaneApiFromEnv } from "./load-env.js";
export { loadDataPlaneApiFromToml } from "./load-toml.js";
export { DataPlaneApiConfigSchema } from "./schema.js";

export const dataPlaneApiConfigModule: ConfigModule<typeof DataPlaneApiConfigSchema> = {
  namespace: ["apps", "data_plane_api"],
  schema: DataPlaneApiConfigSchema,
  loadToml: loadDataPlaneApiFromToml,
  loadEnv: loadDataPlaneApiFromEnv,
};

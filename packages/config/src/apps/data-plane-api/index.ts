import type { ConfigModule } from "../../core/module.js";
import { loadDataPlaneApiFromEnv } from "./load-env.js";
import { DataPlaneApiConfigSchema } from "./schema.js";

export { loadDataPlaneApiFromEnv } from "./load-env.js";
export { DataPlaneApiConfigSchema } from "./schema.js";

export const dataPlaneApiConfigModule: ConfigModule<typeof DataPlaneApiConfigSchema> = {
  namespace: ["apps", "data_plane_api"],
  schema: DataPlaneApiConfigSchema,
  loadEnv: loadDataPlaneApiFromEnv,
};

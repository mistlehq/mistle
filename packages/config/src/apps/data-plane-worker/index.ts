import type { ConfigModule } from "../../core/module.js";

import { loadDataPlaneWorkerFromEnv } from "./load-env.js";
import { loadDataPlaneWorkerFromToml } from "./load-toml.js";
import { DataPlaneWorkerConfigSchema } from "./schema.js";

export { loadDataPlaneWorkerFromEnv } from "./load-env.js";
export { loadDataPlaneWorkerFromToml } from "./load-toml.js";
export { DataPlaneWorkerConfigSchema } from "./schema.js";

export const dataPlaneWorkerConfigModule: ConfigModule<typeof DataPlaneWorkerConfigSchema> = {
  namespace: ["apps", "data_plane_worker"],
  schema: DataPlaneWorkerConfigSchema,
  loadToml: loadDataPlaneWorkerFromToml,
  loadEnv: loadDataPlaneWorkerFromEnv,
};

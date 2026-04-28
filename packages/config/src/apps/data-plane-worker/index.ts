import { loadDataPlaneWorkerFromEnv } from "./load-env.js";
import { DataPlaneWorkerConfigSchema } from "./schema.js";

export { loadDataPlaneWorkerFromEnv } from "./load-env.js";
export { DataPlaneWorkerConfigSchema } from "./schema.js";

export const dataPlaneWorkerConfigModule = {
  schema: DataPlaneWorkerConfigSchema,
  loadEnv: loadDataPlaneWorkerFromEnv,
};

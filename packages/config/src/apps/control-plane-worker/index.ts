import { loadControlPlaneWorkerFromEnv } from "./load-env.js";
import { ControlPlaneWorkerConfigSchema } from "./schema.js";

export { loadControlPlaneWorkerFromEnv } from "./load-env.js";
export { ControlPlaneWorkerConfigSchema } from "./schema.js";

export const controlPlaneWorkerConfigModule = {
  schema: ControlPlaneWorkerConfigSchema,
  loadEnv: loadControlPlaneWorkerFromEnv,
};

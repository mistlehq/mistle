import { loadDataPlaneApiFromEnv } from "./load-env.js";
import { DataPlaneApiConfigSchema } from "./schema.js";

export { loadDataPlaneApiFromEnv } from "./load-env.js";
export { DataPlaneApiConfigSchema } from "./schema.js";

export const dataPlaneApiConfigModule = {
  schema: DataPlaneApiConfigSchema,
  loadEnv: loadDataPlaneApiFromEnv,
};

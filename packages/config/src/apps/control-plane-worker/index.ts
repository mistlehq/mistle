import type { ConfigModule } from "../../core/module.js";
import { loadControlPlaneWorkerFromEnv } from "./load-env.js";
import { ControlPlaneWorkerConfigSchema } from "./schema.js";

export { loadControlPlaneWorkerFromEnv } from "./load-env.js";
export { ControlPlaneWorkerConfigSchema } from "./schema.js";

export const controlPlaneWorkerConfigModule: ConfigModule<typeof ControlPlaneWorkerConfigSchema> = {
  namespace: ["apps", "control_plane_worker"],
  schema: ControlPlaneWorkerConfigSchema,
  loadEnv: loadControlPlaneWorkerFromEnv,
};

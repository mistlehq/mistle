import type { ConfigModule } from "../../core/module.js";
import { loadControlPlaneApiFromEnv } from "./load-env.js";
import { loadControlPlaneApiFromToml } from "./load-toml.js";
import { ControlPlaneApiConfigSchema } from "./schema.js";

export { loadControlPlaneApiFromEnv } from "./load-env.js";
export { loadControlPlaneApiFromToml } from "./load-toml.js";
export { ControlPlaneApiConfigSchema } from "./schema.js";

export const controlPlaneApiConfigModule: ConfigModule<typeof ControlPlaneApiConfigSchema> = {
  namespace: ["apps", "control_plane_api"],
  schema: ControlPlaneApiConfigSchema,
  loadToml: loadControlPlaneApiFromToml,
  loadEnv: loadControlPlaneApiFromEnv,
};

import type { ConfigModule } from "../../core/module.js";

import { loadDataPlaneGatewayFromEnv } from "./load-env.js";
import { loadDataPlaneGatewayFromToml } from "./load-toml.js";
import { DataPlaneGatewayConfigSchema } from "./schema.js";

export { loadDataPlaneGatewayFromEnv } from "./load-env.js";
export { loadDataPlaneGatewayFromToml } from "./load-toml.js";
export { DataPlaneGatewayConfigSchema } from "./schema.js";

export const dataPlaneGatewayConfigModule: ConfigModule<typeof DataPlaneGatewayConfigSchema> = {
  namespace: ["apps", "data_plane_gateway"],
  schema: DataPlaneGatewayConfigSchema,
  loadToml: loadDataPlaneGatewayFromToml,
  loadEnv: loadDataPlaneGatewayFromEnv,
};

import type { ConfigModule } from "../../core/module.js";
import { loadDataPlaneGatewayFromEnv } from "./load-env.js";
import { DataPlaneGatewayConfigSchema } from "./schema.js";

export { loadDataPlaneGatewayFromEnv } from "./load-env.js";
export { DataPlaneGatewayConfigSchema } from "./schema.js";

export const dataPlaneGatewayConfigModule: ConfigModule<typeof DataPlaneGatewayConfigSchema> = {
  namespace: ["apps", "data_plane_gateway"],
  schema: DataPlaneGatewayConfigSchema,
  loadEnv: loadDataPlaneGatewayFromEnv,
};

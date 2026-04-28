import { loadDataPlaneGatewayFromEnv } from "./load-env.js";
import { DataPlaneGatewayConfigSchema } from "./schema.js";

export { loadDataPlaneGatewayFromEnv } from "./load-env.js";
export { DataPlaneGatewayConfigSchema } from "./schema.js";

export const dataPlaneGatewayConfigModule = {
  schema: DataPlaneGatewayConfigSchema,
  loadEnv: loadDataPlaneGatewayFromEnv,
};

import { loadControlPlaneApiFromEnv } from "./load-env.js";
import { ControlPlaneApiConfigSchema } from "./schema.js";

export { loadControlPlaneApiFromEnv } from "./load-env.js";
export { ControlPlaneApiConfigSchema } from "./schema.js";
export { deriveDashboardAuthMethods } from "./dashboard-auth-methods.js";
export type { DashboardAuthMethodsConfig } from "./dashboard-auth-methods.js";

export const controlPlaneApiConfigModule = {
  schema: ControlPlaneApiConfigSchema,
  loadEnv: loadControlPlaneApiFromEnv,
};

import { ControlPlaneApiConfigSchema } from "./schema.js";

export { ControlPlaneApiConfigSchema } from "./schema.js";
export { deriveDashboardAuthMethods } from "./dashboard-auth-methods.js";
export type { DashboardAuthMethodsConfig } from "./dashboard-auth-methods.js";

export const controlPlaneApiConfigModule = {
  schema: ControlPlaneApiConfigSchema,
};

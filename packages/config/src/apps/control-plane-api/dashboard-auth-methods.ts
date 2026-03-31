import type { ControlPlaneApiConfig } from "./schema.js";

export type DashboardAuthMethodsConfig = {
  google: boolean;
};

export function deriveDashboardAuthMethods(
  authConfig: Pick<ControlPlaneApiConfig["auth"], "google">,
): DashboardAuthMethodsConfig {
  return {
    google: authConfig.google !== undefined,
  };
}

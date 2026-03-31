import type { ControlPlaneApiConfig } from "./schema.js";

export type DashboardAuthMethodsConfig = {
  emailOtp: boolean;
  google: boolean;
};

export function deriveDashboardAuthMethods(
  authConfig: Pick<ControlPlaneApiConfig["auth"], "google">,
): DashboardAuthMethodsConfig {
  return {
    emailOtp: true,
    google: authConfig.google !== undefined,
  };
}

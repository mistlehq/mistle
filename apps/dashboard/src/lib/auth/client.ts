import { emailOTPClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { getDashboardConfig } from "../../config.js";

function createDashboardAuthClient() {
  const dashboardConfig = getDashboardConfig();

  return createAuthClient({
    baseURL: dashboardConfig.controlPlaneApiOrigin,
    basePath: dashboardConfig.authBasePath,
    plugins: [emailOTPClient(), organizationClient()],
  });
}

type DashboardAuthClient = ReturnType<typeof createDashboardAuthClient>;

let cachedAuthClient: DashboardAuthClient | undefined;

function getAuthClient(): DashboardAuthClient {
  cachedAuthClient ??= createDashboardAuthClient();

  return cachedAuthClient;
}

export function resetAuthClientForTest(): void {
  cachedAuthClient = undefined;
}

export const authClient: Pick<
  DashboardAuthClient,
  "$fetch" | "emailOtp" | "getSession" | "organization" | "signIn" | "signOut"
> = {
  get $fetch() {
    return getAuthClient().$fetch;
  },
  get emailOtp() {
    return getAuthClient().emailOtp;
  },
  get getSession() {
    return getAuthClient().getSession;
  },
  get organization() {
    return getAuthClient().organization;
  },
  get signIn() {
    return getAuthClient().signIn;
  },
  get signOut() {
    return getAuthClient().signOut;
  },
};

import { emailOTPClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { getDashboardConfig } from "../../config.js";

const dashboardConfig = getDashboardConfig();

export const authClient = createAuthClient({
  baseURL: dashboardConfig.controlPlaneApiOrigin,
  basePath: dashboardConfig.authBasePath,
  plugins: [emailOTPClient(), organizationClient()],
});

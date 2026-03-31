import type { DataPlaneGatewayApp, DataPlaneGatewayGlobalConfig } from "../types.js";

type RegisterPublishedTargetRoutesInput = {
  app: DataPlaneGatewayApp;
  publishConfig: DataPlaneGatewayGlobalConfig["sandbox"]["publish"];
};

/**
 * PR 1 intentionally installs only the registration seam.
 * Later PRs add bootstrap and published-host behavior here.
 */
export function registerPublishedTargetRoutes(_input: RegisterPublishedTargetRoutesInput): void {}

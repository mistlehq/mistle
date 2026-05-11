import { getDashboardConfig } from "../config.js";

export function getDashboardStoryControlPlaneApiOrigin(): string {
  return getDashboardConfig().controlPlaneApiOrigin;
}

import {
  checkDashboardBuildDrift,
  requestDashboardBuildDriftSchemaMismatchPrompt,
} from "./dashboard-build-drift.js";

export async function checkDashboardBuildDriftAfterSchemaValidationFailure(): Promise<void> {
  const status = await checkDashboardBuildDrift().catch(() => null);
  if (status?.kind === "drift") {
    requestDashboardBuildDriftSchemaMismatchPrompt();
  }
}

import { MaterializeSandboxProfileVersionSnapshotWorkflow } from "./materialize-sandbox-profile-version-snapshot/workflow.js";
import { ReconcileSandboxInstanceWorkflow } from "./reconcile-sandbox-instance/workflow.js";
import { ResumeSandboxInstanceWorkflow } from "./resume-sandbox-instance/workflow.js";
import { HandleSandboxInstanceDeadlineWorkflow } from "./sandbox-instance-deadlines/workflow.js";
import { StartSandboxInstanceWorkflow } from "./start-sandbox-instance/workflow.js";
import { StopSandboxInstanceWorkflow } from "./stop-sandbox-instance/workflow.js";

/**
 * Explicit workflow manifest used by the test harness worker host.
 *
 * Production workers still start through the OpenWorkflow CLI config, which
 * performs directory discovery. The harness imports this manifest once per
 * Vitest worker process so logical test environments can start workers without
 * repeating CLI discovery and module loading for every environment.
 */
export const DataPlaneWorkerWorkflows = [
  MaterializeSandboxProfileVersionSnapshotWorkflow,
  ReconcileSandboxInstanceWorkflow,
  ResumeSandboxInstanceWorkflow,
  HandleSandboxInstanceDeadlineWorkflow,
  StartSandboxInstanceWorkflow,
  StopSandboxInstanceWorkflow,
];

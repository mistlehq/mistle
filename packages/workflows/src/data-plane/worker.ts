import type { SandboxProvider } from "@mistle/sandbox";
import type { OpenWorkflow, Worker } from "openworkflow";

import { createDataPlaneWorkflowDefinitions } from "./workflows/index.js";
import type { StartSandboxInstanceWorkflowInput } from "./workflows/start-sandbox-instance/index.js";

export type UpdateDataPlaneSandboxInstanceStatusInput =
  | {
      sandboxInstanceId: string;
      status: "running";
    }
  | {
      sandboxInstanceId: string;
      status: "failed";
      failureCode: string;
      failureMessage: string;
    };

export type DataPlaneWorkerDependencies = {
  startSandbox: (input: {
    image: StartSandboxInstanceWorkflowInput["image"];
    runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  }) => Promise<{
    provider: SandboxProvider;
    providerSandboxId: string;
    bootstrapTokenJti: string;
  }>;
  stopSandbox: (input: { provider: SandboxProvider; providerSandboxId: string }) => Promise<void>;
  insertSandboxInstance: (input: {
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
    provider: SandboxProvider;
    providerSandboxId: string;
    startedBy: StartSandboxInstanceWorkflowInput["startedBy"];
    source: StartSandboxInstanceWorkflowInput["source"];
  }) => Promise<{
    sandboxInstanceId: string;
  }>;
  waitForSandboxTunnelConnectAck: (input: { bootstrapTokenJti: string }) => Promise<boolean>;
  updateSandboxInstanceStatus: (input: UpdateDataPlaneSandboxInstanceStatusInput) => Promise<void>;
};

export type CreateDataPlaneWorkerInput = {
  openWorkflow: OpenWorkflow;
  maxConcurrentWorkflows: number;
  deps: DataPlaneWorkerDependencies;
};

/**
 * Creates a data-plane OpenWorkflow worker and registers all workflows.
 */
export function createDataPlaneWorker(input: CreateDataPlaneWorkerInput): Worker {
  const workflows = createDataPlaneWorkflowDefinitions({
    startSandboxInstance: input.deps,
  });
  input.openWorkflow.implementWorkflow(
    workflows.startSandboxInstance.spec,
    workflows.startSandboxInstance.fn,
  );

  return input.openWorkflow.newWorker({
    concurrency: input.maxConcurrentWorkflows,
  });
}

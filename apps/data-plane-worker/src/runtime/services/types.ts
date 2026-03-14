import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import type { SandboxAdapter } from "@mistle/sandbox";
import type { Clock, Sleeper } from "@mistle/time";

import type { DataPlaneWorkerRuntimeConfig } from "../../types.js";
import type {
  DataPlaneWorkerServices,
  StartSandboxInstanceWorkflowServices,
} from "../workflow-types.js";

export type TunnelReadinessPolicy = {
  timeoutMs: number;
  pollIntervalMs: number;
};

export type SandboxLifecycleService = StartSandboxInstanceWorkflowServices["sandboxLifecycle"];
export type SandboxInstanceStoreService = StartSandboxInstanceWorkflowServices["sandboxInstances"];
export type TunnelReadinessService = StartSandboxInstanceWorkflowServices["tunnelReadiness"];

export type StartSandboxInput = Parameters<SandboxLifecycleService["startSandbox"]>[0];
export type StartSandboxOutput = Awaited<ReturnType<SandboxLifecycleService["startSandbox"]>>;
export type StopSandboxInput = Parameters<SandboxLifecycleService["stopSandbox"]>[0];
export type EnsureSandboxInstanceInput = Parameters<
  SandboxInstanceStoreService["ensureSandboxInstance"]
>[0];
export type EnsureSandboxInstanceOutput = Awaited<
  ReturnType<SandboxInstanceStoreService["ensureSandboxInstance"]>
>;
export type PersistSandboxInstanceProvisioningInput = Parameters<
  SandboxInstanceStoreService["persistSandboxInstanceProvisioning"]
>[0];
export type MarkSandboxInstanceRunningInput = Parameters<
  SandboxInstanceStoreService["markSandboxInstanceRunning"]
>[0];
export type MarkSandboxInstanceFailedInput = Parameters<
  SandboxInstanceStoreService["markSandboxInstanceFailed"]
>[0];
export type WaitForSandboxTunnelReadinessInput = Parameters<
  TunnelReadinessService["waitForSandboxTunnelReadiness"]
>[0];

export type CreateDataPlaneWorkerServicesInput = {
  config: DataPlaneWorkerRuntimeConfig;
  db: DataPlaneDatabase;
  sandboxAdapter: SandboxAdapter;
  tunnelReadinessPolicy: TunnelReadinessPolicy;
  clock: Clock;
  sleeper: Sleeper;
};

export type { DataPlaneWorkerServices };

import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import type { SandboxAdapter } from "@mistle/sandbox";
import type { Clock, Sleeper } from "@mistle/time";
import type {
  DataPlaneWorkerServices,
  StartSandboxInstanceWorkflowServices,
} from "@mistle/workflows/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../../types.js";

export type TunnelConnectAckPolicy = {
  timeoutMs: number;
  pollIntervalMs: number;
};

export type SandboxLifecycleService = StartSandboxInstanceWorkflowServices["sandboxLifecycle"];
export type SandboxInstanceStoreService = StartSandboxInstanceWorkflowServices["sandboxInstances"];
export type TunnelConnectAckService = StartSandboxInstanceWorkflowServices["tunnelConnectAcks"];

export type StartSandboxInput = Parameters<SandboxLifecycleService["startSandbox"]>[0];
export type StartSandboxOutput = Awaited<ReturnType<SandboxLifecycleService["startSandbox"]>>;
export type StopSandboxInput = Parameters<SandboxLifecycleService["stopSandbox"]>[0];
export type CreateSandboxInstanceInput = Parameters<
  SandboxInstanceStoreService["createSandboxInstance"]
>[0];
export type CreateSandboxInstanceOutput = Awaited<
  ReturnType<SandboxInstanceStoreService["createSandboxInstance"]>
>;
export type MarkSandboxInstanceRunningInput = Parameters<
  SandboxInstanceStoreService["markSandboxInstanceRunning"]
>[0];
export type MarkSandboxInstanceFailedInput = Parameters<
  SandboxInstanceStoreService["markSandboxInstanceFailed"]
>[0];
export type WaitForSandboxTunnelConnectAckInput = Parameters<
  TunnelConnectAckService["waitForSandboxTunnelConnectAck"]
>[0];

export type CreateDataPlaneWorkerServicesInput = {
  config: DataPlaneWorkerRuntimeConfig;
  db: DataPlaneDatabase;
  sandboxAdapter: SandboxAdapter;
  tunnelConnectAckPolicy: TunnelConnectAckPolicy;
  clock: Clock;
  sleeper: Sleeper;
};

export type { DataPlaneWorkerServices };

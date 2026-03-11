import type { DataPlaneWorkerRuntimeConfig } from "../../src/worker/types.js";
import type { StartSandboxInstanceWorkflowInput } from "./index.js";

export type TunnelConnectAckPolicy = {
  timeoutMs: number;
  pollIntervalMs: number;
};

export type StartSandboxInput = {
  sandboxInstanceId: string;
  image: StartSandboxInstanceWorkflowInput["image"];
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
};

export type StartSandboxOutput = {
  sandboxInstanceId: string;
  provider: DataPlaneWorkerRuntimeConfig["sandbox"]["provider"];
  providerSandboxId: string;
  bootstrapTokenJti: string;
};

export type StopSandboxInput = {
  provider: DataPlaneWorkerRuntimeConfig["sandbox"]["provider"];
  providerSandboxId: string;
};

export type EnsureSandboxInstanceInput = {
  sandboxInstanceId: string;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  startedBy: StartSandboxInstanceWorkflowInput["startedBy"];
  source: StartSandboxInstanceWorkflowInput["source"];
};

export type EnsureSandboxInstanceOutput = {
  sandboxInstanceId: string;
};

export type PersistSandboxInstanceProvisioningInput = {
  sandboxInstanceId: string;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  providerSandboxId: string;
};

export type MarkSandboxInstanceRunningInput = {
  sandboxInstanceId: string;
};

export type MarkSandboxInstanceFailedInput = {
  sandboxInstanceId: string;
  failureCode: string;
  failureMessage: string;
};

export type WaitForSandboxTunnelConnectAckInput = {
  bootstrapTokenJti: string;
};

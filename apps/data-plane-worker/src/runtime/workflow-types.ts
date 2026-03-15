import type { SandboxProvider } from "@mistle/sandbox";
import type {
  StartSandboxInstanceWorkflowImageInput,
  StartSandboxInstanceWorkflowInput,
} from "@mistle/workflow-registry/data-plane";

export type StartSandboxInstanceWorkflowServices = {
  sandboxLifecycle: {
    startSandbox: (input: {
      sandboxInstanceId: string;
      image: StartSandboxInstanceWorkflowImageInput;
      runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
    }) => Promise<{
      sandboxInstanceId: string;
      provider: SandboxProvider;
      providerSandboxId: string;
    }>;
    stopSandbox: (input: { provider: SandboxProvider; providerSandboxId: string }) => Promise<void>;
  };
  sandboxInstances: {
    ensureSandboxInstance: (input: {
      sandboxInstanceId: string;
      organizationId: string;
      sandboxProfileId: string;
      sandboxProfileVersion: number;
      startedBy: StartSandboxInstanceWorkflowInput["startedBy"];
      source: StartSandboxInstanceWorkflowInput["source"];
    }) => Promise<{
      sandboxInstanceId: string;
    }>;
    persistSandboxInstanceProvisioning: (input: {
      sandboxInstanceId: string;
      runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
      sandboxProfileId: string;
      sandboxProfileVersion: number;
      providerSandboxId: string;
    }) => Promise<void>;
    markSandboxInstanceRunning: (input: { sandboxInstanceId: string }) => Promise<void>;
    markSandboxInstanceFailed: (input: {
      sandboxInstanceId: string;
      failureCode: string;
      failureMessage: string;
    }) => Promise<void>;
  };
  tunnelReadiness: {
    waitForSandboxTunnelReadiness: (input: { sandboxInstanceId: string }) => Promise<boolean>;
  };
};

export type DataPlaneWorkerServices = {
  startSandboxInstance: StartSandboxInstanceWorkflowServices;
  executionLeases: {
    readSandboxExecutionLeaseState: (input: {
      sandboxInstanceId: string;
      freshSince: string;
    }) => Promise<{
      newestLastSeenAt: string | null;
      hasFreshExecutionLease: boolean;
    }>;
  };
};

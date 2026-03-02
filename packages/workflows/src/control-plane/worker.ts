import type { EmailSender } from "@mistle/emails";
import type { OpenWorkflow, Worker } from "openworkflow";

import { createControlPlaneWorkflowDefinitions } from "./workflows/index.js";
import type {
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput,
} from "./workflows/start-sandbox-profile-instance/index.js";

export type ControlPlaneWorkerEmailDelivery = {
  emailSender: EmailSender;
  from: {
    email: string;
    name: string;
  };
};

export type ControlPlaneWorkerDependencies = {
  emailDelivery: ControlPlaneWorkerEmailDelivery;
  deleteSandboxProfile: (input: { organizationId: string; profileId: string }) => Promise<void>;
  startSandboxProfileInstance: (
    input: StartSandboxProfileInstanceWorkflowInput,
  ) => Promise<StartSandboxProfileInstanceWorkflowOutput>;
};

export type CreateControlPlaneWorkerInput = {
  openWorkflow: OpenWorkflow;
  maxConcurrentWorkflows: number;
  deps: ControlPlaneWorkerDependencies;
};

/**
 * Creates a control-plane OpenWorkflow worker and registers all workflows.
 */
export function createControlPlaneWorker(input: CreateControlPlaneWorkerInput): Worker {
  const workflows = createControlPlaneWorkflowDefinitions({
    sendOrganizationInvitation: input.deps.emailDelivery,
    sendVerificationOTP: input.deps.emailDelivery,
    requestDeleteSandboxProfile: {
      deleteSandboxProfile: input.deps.deleteSandboxProfile,
    },
    startSandboxProfileInstance: {
      startSandboxInstance: input.deps.startSandboxProfileInstance,
    },
  });
  input.openWorkflow.implementWorkflow(
    workflows.sendOrganizationInvitation.spec,
    workflows.sendOrganizationInvitation.fn,
  );
  input.openWorkflow.implementWorkflow(
    workflows.sendVerificationOTP.spec,
    workflows.sendVerificationOTP.fn,
  );
  input.openWorkflow.implementWorkflow(
    workflows.requestDeleteSandboxProfile.spec,
    workflows.requestDeleteSandboxProfile.fn,
  );
  input.openWorkflow.implementWorkflow(
    workflows.startSandboxProfileInstance.spec,
    workflows.startSandboxProfileInstance.fn,
  );

  return input.openWorkflow.newWorker({
    concurrency: input.maxConcurrentWorkflows,
  });
}

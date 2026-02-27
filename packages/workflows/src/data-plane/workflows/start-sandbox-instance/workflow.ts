import { defineWorkflow, type Workflow } from "openworkflow";

import {
  StartSandboxInstanceWorkflowSpec,
  type StartSandboxInstanceWorkflowInput,
  type StartSandboxInstanceWorkflowOutput,
} from "./spec.js";

export type CreateStartSandboxInstanceWorkflowInput = {
  startSandbox: (input: { image: StartSandboxInstanceWorkflowInput["image"] }) => Promise<{
    provider: "modal";
    providerSandboxId: string;
  }>;
  stopSandbox: (input: { provider: "modal"; providerSandboxId: string }) => Promise<void>;
  insertSandboxInstance: (input: {
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    manifest: Record<string, unknown>;
    provider: "modal";
    providerSandboxId: string;
    startedBy: {
      kind: "user";
      id: string;
    };
    source: "dashboard";
  }) => Promise<{
    sandboxInstanceId: string;
  }>;
};

export function createStartSandboxInstanceWorkflow(
  input: CreateStartSandboxInstanceWorkflowInput,
): Workflow<
  StartSandboxInstanceWorkflowInput,
  StartSandboxInstanceWorkflowOutput,
  StartSandboxInstanceWorkflowInput
> {
  return defineWorkflow(
    StartSandboxInstanceWorkflowSpec,
    async ({ input: workflowInput, step }) => {
      const startedSandbox = await step.run({ name: "start-sandbox" }, async () => {
        return input.startSandbox({
          image: workflowInput.image,
        });
      });

      try {
        const persistedSandboxInstance = await step.run(
          { name: "insert-sandbox-instance" },
          async () => {
            return input.insertSandboxInstance({
              organizationId: workflowInput.organizationId,
              sandboxProfileId: workflowInput.sandboxProfileId,
              sandboxProfileVersion: workflowInput.sandboxProfileVersion,
              manifest: workflowInput.manifest,
              provider: startedSandbox.provider,
              providerSandboxId: startedSandbox.providerSandboxId,
              startedBy: workflowInput.startedBy,
              source: workflowInput.source,
            });
          },
        );

        return {
          sandboxInstanceId: persistedSandboxInstance.sandboxInstanceId,
          providerSandboxId: startedSandbox.providerSandboxId,
        };
      } catch (error) {
        await step.run({ name: "rollback-stop-sandbox" }, async () => {
          await input.stopSandbox({
            provider: startedSandbox.provider,
            providerSandboxId: startedSandbox.providerSandboxId,
          });
        });

        throw new Error(
          "Failed to persist sandbox instance after provider sandbox start. Provider sandbox was stopped.",
          { cause: error },
        );
      }
    },
  );
}

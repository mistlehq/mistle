import { defineWorkflow, type Workflow } from "openworkflow";

import type { StartSandboxInstanceWorkflowInput } from "../../../data-plane/workflows/start-sandbox-instance/spec.js";

import {
  StartSandboxProfileInstanceWorkflowSpec,
  type StartSandboxProfileInstanceWorkflowInput,
  type StartSandboxProfileInstanceWorkflowOutput,
} from "./spec.js";

type ResolvedSandboxProfileVersion = Pick<StartSandboxInstanceWorkflowInput, "manifest" | "image">;

export type CreateStartSandboxProfileInstanceWorkflowInput = {
  resolveSandboxProfileVersion: (input: {
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  }) => Promise<ResolvedSandboxProfileVersion>;
  startSandboxInstance: (
    input: StartSandboxInstanceWorkflowInput,
  ) => Promise<StartSandboxProfileInstanceWorkflowOutput>;
};

/**
 * Creates a control-plane workflow that resolves profile version configuration and
 * starts a sandbox instance through the data-plane API.
 */
export function createStartSandboxProfileInstanceWorkflow(
  ctx: CreateStartSandboxProfileInstanceWorkflowInput,
): Workflow<
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput,
  StartSandboxProfileInstanceWorkflowInput
> {
  return defineWorkflow(
    StartSandboxProfileInstanceWorkflowSpec,
    async ({ input: workflowInput, step }) => {
      const resolvedProfileVersion = await step.run(
        { name: "resolve-sandbox-profile-version" },
        async () =>
          ctx.resolveSandboxProfileVersion({
            organizationId: workflowInput.organizationId,
            sandboxProfileId: workflowInput.sandboxProfileId,
            sandboxProfileVersion: workflowInput.sandboxProfileVersion,
          }),
      );

      const startedSandbox = await step.run(
        { name: "start-sandbox-instance-in-data-plane" },
        async () =>
          ctx.startSandboxInstance({
            organizationId: workflowInput.organizationId,
            sandboxProfileId: workflowInput.sandboxProfileId,
            sandboxProfileVersion: workflowInput.sandboxProfileVersion,
            manifest: resolvedProfileVersion.manifest,
            startedBy: workflowInput.startedBy,
            source: workflowInput.source,
            image: resolvedProfileVersion.image,
          }),
      );

      return startedSandbox;
    },
  );
}

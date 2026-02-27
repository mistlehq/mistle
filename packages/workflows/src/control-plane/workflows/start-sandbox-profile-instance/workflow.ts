import { defineWorkflow, type Workflow } from "openworkflow";

import type { StartSandboxInstanceWorkflowInput } from "../../../data-plane/workflows/start-sandbox-instance/spec.js";

import {
  StartSandboxProfileInstanceWorkflowSpec,
  type StartSandboxProfileInstanceWorkflowInput,
  type StartSandboxProfileInstanceWorkflowOutput,
} from "./spec.js";

type ResolvedSandboxProfileVersion = Pick<StartSandboxInstanceWorkflowInput, "manifest">;

export type CreateStartSandboxProfileInstanceWorkflowInput = {
  resolveSandboxProfileVersion: (ctx: {
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  }) => Promise<ResolvedSandboxProfileVersion>;
  startSandboxInstance: (
    ctx: StartSandboxInstanceWorkflowInput,
  ) => Promise<StartSandboxProfileInstanceWorkflowOutput>;
};

/**
 * Creates a control-plane workflow that resolves profile version configuration and
 * starts a sandbox instance through the data-plane API.
 */
export function createStartSandboxProfileInstanceWorkflow(
  createCtx: CreateStartSandboxProfileInstanceWorkflowInput,
): Workflow<
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput,
  StartSandboxProfileInstanceWorkflowInput
> {
  return defineWorkflow(StartSandboxProfileInstanceWorkflowSpec, async (ctx) => {
    const workflowInput = ctx.input;
    const resolvedProfileVersion = await ctx.step.run(
      { name: "resolve-sandbox-profile-version" },
      async () =>
        createCtx.resolveSandboxProfileVersion({
          organizationId: workflowInput.organizationId,
          sandboxProfileId: workflowInput.sandboxProfileId,
          sandboxProfileVersion: workflowInput.sandboxProfileVersion,
        }),
    );

    const startedSandbox = await ctx.step.run(
      { name: "start-sandbox-instance-in-data-plane" },
      async () =>
        createCtx.startSandboxInstance({
          organizationId: workflowInput.organizationId,
          sandboxProfileId: workflowInput.sandboxProfileId,
          sandboxProfileVersion: workflowInput.sandboxProfileVersion,
          manifest: resolvedProfileVersion.manifest,
          startedBy: workflowInput.startedBy,
          source: workflowInput.source,
          image: workflowInput.image,
        }),
    );

    return startedSandbox;
  });
}

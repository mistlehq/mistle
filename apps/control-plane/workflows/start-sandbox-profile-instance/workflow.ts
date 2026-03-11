import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import type { SandboxImageHandle } from "@mistle/sandbox";
import { defineWorkflow, defineWorkflowSpec } from "openworkflow";

import { getControlPlaneWorkflowRuntime } from "../runtime-context.js";
import { startSandboxProfileInstance } from "./service.js";

export type StartSandboxProfileInstanceWorkflowImageInput = Pick<
  SandboxImageHandle,
  "imageId" | "kind" | "createdAt"
>;

export type StartSandboxProfileInstanceWorkflowInput = {
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  runtimePlan: CompiledRuntimePlan;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
  image: StartSandboxProfileInstanceWorkflowImageInput;
};

export type StartSandboxProfileInstanceWorkflowOutput = {
  workflowRunId: string;
  sandboxInstanceId: string;
};

/**
 * Creates a control-plane workflow that starts a sandbox instance through the data-plane API.
 */
export const StartSandboxProfileInstanceWorkflow = defineWorkflow(
  defineWorkflowSpec<
    StartSandboxProfileInstanceWorkflowInput,
    StartSandboxProfileInstanceWorkflowOutput
  >({
    name: "control-plane.sandbox-instances.start-profile-instance",
    version: "1",
  }),
  async (workflowCtx) => {
    const runtime = await getControlPlaneWorkflowRuntime();
    const workflowInput = workflowCtx.input;
    const startedSandbox = await workflowCtx.step.run(
      { name: "start-sandbox-instance-in-data-plane" },
      async () =>
        startSandboxProfileInstance(
          {
            db: runtime.db,
            dataPlaneSandboxInstancesClient: runtime.dataPlaneSandboxInstancesClient,
          },
          workflowInput,
        ),
    );

    return startedSandbox;
  },
);

export const StartSandboxProfileInstanceWorkflowSpec = StartSandboxProfileInstanceWorkflow.spec;

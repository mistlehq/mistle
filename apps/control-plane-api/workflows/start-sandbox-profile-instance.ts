import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "./context.js";

export type StartSandboxProfileInstanceWorkflowImageInput = {
  imageId: string;
  kind: "base" | "snapshot";
  createdAt: string;
};

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

async function verifySandboxProfileVersionExists(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
}): Promise<void> {
  const sandboxProfile = await input.db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.sandboxProfileId), eq(table.organizationId, input.organizationId)),
  });

  if (sandboxProfile === undefined) {
    throw new Error("Sandbox profile was not found.");
  }

  const sandboxProfileVersion = await input.db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProfileId: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.sandboxProfileId),
        eq(table.version, input.sandboxProfileVersion),
      ),
  });

  if (sandboxProfileVersion === undefined) {
    throw new Error("Sandbox profile version was not found.");
  }
}

export const StartSandboxProfileInstanceWorkflow = defineWorkflow<
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput
>(
  {
    name: "control-plane.sandbox-instances.start-profile-instance",
    version: "1",
  },
  async ({ input, step }) => {
    const ctx = await getWorkflowContext();

    return step.run(
      {
        name: "start-sandbox-instance-in-data-plane",
      },
      async () => {
        await verifySandboxProfileVersionExists({
          db: ctx.db,
          organizationId: input.organizationId,
          sandboxProfileId: input.sandboxProfileId,
          sandboxProfileVersion: input.sandboxProfileVersion,
        });

        const startedSandbox = await ctx.dataPlaneClient.startSandboxInstance(input);

        return {
          workflowRunId: startedSandbox.workflowRunId,
          sandboxInstanceId: startedSandbox.sandboxInstanceId,
        };
      },
    );
  },
);

import type { StartSandboxInstanceInput } from "@mistle/data-plane-internal-client";
import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";

import { compileProfileVersionRuntimePlan } from "../../../sandbox-profiles/compile-profile-version-runtime-plan.js";
import {
  SandboxProfilesCompileError,
  SandboxProfilesCompileErrorCodes,
} from "../../../sandbox-profiles/errors.js";
import type { AppContext } from "../../../types.js";

type StartProfileInstanceInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
};

function cloneStartSandboxRuntimePlan(input: unknown): StartSandboxInstanceInput["runtimePlan"] {
  const clonedRuntimePlan: StartSandboxInstanceInput["runtimePlan"] = JSON.parse(
    JSON.stringify(input),
  );

  return clonedRuntimePlan;
}

export async function startProfileInstance(
  {
    db,
    integrationsConfig,
    dataPlaneClient,
    defaultBaseImage,
  }: {
    db: AppContext["var"]["db"];
    integrationsConfig: AppContext["var"]["config"]["integrations"];
    dataPlaneClient: AppContext["var"]["dataPlaneClient"];
    defaultBaseImage: string;
  },
  input: StartProfileInstanceInput,
): Promise<{
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
}> {
  const runtimePlan = await compileProfileVersionRuntimePlan(
    {
      db,
      integrationsConfig,
    },
    {
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      image: {
        source: "base",
        imageRef: defaultBaseImage,
      },
    },
  );
  if (runtimePlan.agentRuntimes.length === 0) {
    throw new SandboxProfilesCompileError(
      SandboxProfilesCompileErrorCodes.AGENT_RUNTIME_REQUIRED,
      `Sandbox profile '${input.profileId}' version ${String(input.profileVersion)} does not declare an agent runtime. Add an agent integration binding before starting a session.`,
    );
  }

  const startedSandbox = await dataPlaneClient.startSandboxInstance({
    organizationId: input.organizationId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.profileVersion,
    runtimePlan: cloneStartSandboxRuntimePlan(runtimePlan),
    startedBy: input.startedBy,
    source: input.source,
    image: {
      imageId: defaultBaseImage,
      createdAt: new Date().toISOString(),
    },
  });

  return {
    status: startedSandbox.status,
    workflowRunId: startedSandbox.workflowRunId,
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
  };
}

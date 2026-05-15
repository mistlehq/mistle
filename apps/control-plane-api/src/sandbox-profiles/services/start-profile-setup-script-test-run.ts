import type { SandboxProfileVersionAgentRuntimeId } from "@mistle/db/control-plane";
import {
  SandboxInstancePurposes,
  type SandboxInstanceSource,
  type SandboxInstanceStarterKind,
} from "@mistle/db/data-plane";

import type { SandboxProfileVersionResources } from "./profile-version-runtime-config.js";
import { startProfileSetupSandbox } from "./start-profile-setup-sandbox.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type StartProfileSetupScriptTestRunInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  setupScript: string;
  agentRuntimeId?: SandboxProfileVersionAgentRuntimeId;
  sandboxRuntimeConfig?: {
    sandboxProvider: string;
    sandboxConnectionId: string | null;
    sandboxResources: SandboxProfileVersionResources | null;
  };
  idempotencyKey?: string;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
};

type StartProfileSetupScriptTestRunOutput = {
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
};

export async function startProfileSetupScriptTestRun(
  {
    db,
    integrationRegistry,
    integrationsConfig,
    sandboxConfig,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationsConfig" | "dataPlaneClient"> & {
    integrationRegistry: CreateSandboxProfilesServiceInput["integrationRegistry"];
    sandboxConfig: CreateSandboxProfilesServiceInput["sandboxConfig"];
    defaultBaseImage: string;
  },
  input: StartProfileSetupScriptTestRunInput,
): Promise<StartProfileSetupScriptTestRunOutput> {
  return await startProfileSetupSandbox(
    {
      db,
      integrationRegistry,
      integrationsConfig,
      sandboxConfig,
      dataPlaneClient,
      defaultBaseImage,
    },
    {
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      purpose: SandboxInstancePurposes.SETUP_CHECK,
      setupScript: input.setupScript,
      ...(input.agentRuntimeId === undefined ? {} : { agentRuntimeId: input.agentRuntimeId }),
      ...(input.sandboxRuntimeConfig === undefined
        ? {}
        : { sandboxRuntimeConfig: input.sandboxRuntimeConfig }),
      startedBy: input.startedBy,
      source: input.source,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    },
  );
}

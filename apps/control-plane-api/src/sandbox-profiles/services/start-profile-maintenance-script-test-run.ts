import type { SandboxProfileVersionAgentRuntimeId } from "@mistle/db/control-plane";
import {
  SandboxInstancePurposes,
  type SandboxInstanceSource,
  type SandboxInstanceStarterKind,
} from "@mistle/db/data-plane";

import type { SandboxProfileVersionResources } from "./profile-version-runtime-config.js";
import { resolveMaintenanceSnapshotImageId } from "./resolve-maintenance-snapshot-image.js";
import { startProfileSetupSandbox } from "./start-profile-setup-sandbox.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type StartProfileMaintenanceScriptTestRunInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  maintenanceScript: string;
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

type StartProfileMaintenanceScriptTestRunOutput = {
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
};

type StartProfileMaintenanceScriptServiceInput = Pick<
  CreateSandboxProfilesServiceInput,
  "db" | "integrationsConfig" | "mcpConfig" | "dataPlaneClient"
> & {
  integrationRegistry: CreateSandboxProfilesServiceInput["integrationRegistry"];
  sandboxConfig: CreateSandboxProfilesServiceInput["sandboxConfig"];
  defaultBaseImage: string;
};

export async function startProfileMaintenanceScriptTestRun(
  serviceInput: StartProfileMaintenanceScriptServiceInput,
  input: StartProfileMaintenanceScriptTestRunInput,
): Promise<StartProfileMaintenanceScriptTestRunOutput> {
  const snapshotImageId = await resolveMaintenanceSnapshotImageId(serviceInput, input);

  return await startProfileSetupSandbox(serviceInput, {
    organizationId: input.organizationId,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    purpose: SandboxInstancePurposes.SETUP_CHECK,
    setupScript: input.maintenanceScript,
    snapshotPreparationScriptKind: "maintenance",
    image: {
      kind: "snapshot",
      imageId: snapshotImageId,
    },
    ...(input.agentRuntimeId === undefined ? {} : { agentRuntimeId: input.agentRuntimeId }),
    ...(input.sandboxRuntimeConfig === undefined
      ? {}
      : { sandboxRuntimeConfig: input.sandboxRuntimeConfig }),
    startedBy: input.startedBy,
    source: input.source,
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  });
}

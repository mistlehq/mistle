import { SandboxInstancePurposes, type SandboxInstanceSource } from "@mistle/db/data-plane";

import { resolveMaintenanceSnapshotImageId } from "./resolve-maintenance-snapshot-image.js";
import { startProfileSetupSandbox } from "./start-profile-setup-sandbox.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type StartProfileMaintenanceSetupAssistantServiceInput = Pick<
  CreateSandboxProfilesServiceInput,
  "db" | "integrationsConfig" | "mcpConfig" | "dataPlaneClient"
> & {
  integrationRegistry: CreateSandboxProfilesServiceInput["integrationRegistry"];
  sandboxConfig: CreateSandboxProfilesServiceInput["sandboxConfig"];
  defaultBaseImage: string;
};

type StartProfileMaintenanceSetupAssistantInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  mistleMcpCredentialResolver?: {
    kind: "setup_assistant";
  };
  idempotencyKey?: string;
  startedBy: {
    kind: "user";
    id: string;
  };
  source: SandboxInstanceSource;
};

type StartProfileMaintenanceSetupAssistantOutput = {
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
};

export async function startProfileMaintenanceSetupAssistant(
  serviceInput: StartProfileMaintenanceSetupAssistantServiceInput,
  input: StartProfileMaintenanceSetupAssistantInput,
): Promise<StartProfileMaintenanceSetupAssistantOutput> {
  const snapshotImageId = await resolveMaintenanceSnapshotImageId(serviceInput, input);

  return await startProfileSetupSandbox(serviceInput, {
    organizationId: input.organizationId,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    purpose: SandboxInstancePurposes.SETUP_ASSISTANT,
    snapshotPreparationScriptKind: "maintenance",
    ...(input.mistleMcpCredentialResolver === undefined
      ? {}
      : { mistleMcpCredentialResolver: input.mistleMcpCredentialResolver }),
    image: {
      kind: "snapshot",
      imageId: snapshotImageId,
    },
    startedBy: input.startedBy,
    source: input.source,
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
  });
}

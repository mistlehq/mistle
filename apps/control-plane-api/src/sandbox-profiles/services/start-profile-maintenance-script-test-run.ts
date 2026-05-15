import {
  getControlPlaneDatabaseSchema,
  type SandboxProfileVersionAgentRuntimeId,
} from "@mistle/db/control-plane";
import {
  SandboxInstancePurposes,
  type SandboxInstanceSource,
  type SandboxInstanceStarterKind,
} from "@mistle/db/data-plane";
import { and, eq } from "drizzle-orm";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import type { SandboxProfileVersionResources } from "./profile-version-runtime-config.js";
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

export async function startProfileMaintenanceScriptTestRun(
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
  input: StartProfileMaintenanceScriptTestRunInput,
): Promise<StartProfileMaintenanceScriptTestRunOutput> {
  const tables = getControlPlaneDatabaseSchema(db);
  const [sandboxProfileVersion] = await db
    .select({
      sandboxProfileId: tables.sandboxProfileVersions.sandboxProfileId,
      snapshotImageId: tables.sandboxProfileVersions.snapshotImageId,
    })
    .from(tables.sandboxProfiles)
    .leftJoin(
      tables.sandboxProfileVersions,
      and(
        eq(tables.sandboxProfileVersions.sandboxProfileId, tables.sandboxProfiles.id),
        eq(tables.sandboxProfileVersions.version, input.profileVersion),
      ),
    )
    .where(
      and(
        eq(tables.sandboxProfiles.id, input.profileId),
        eq(tables.sandboxProfiles.organizationId, input.organizationId),
      ),
    );

  if (sandboxProfileVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  if (sandboxProfileVersion.sandboxProfileId === null) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }

  if (sandboxProfileVersion.snapshotImageId === null) {
    throw new SandboxProfilesConflictError(
      SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
      `Sandbox profile version '${String(input.profileVersion)}' does not have a usable snapshot.`,
    );
  }

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
      setupScript: input.maintenanceScript,
      snapshotPreparationScriptKind: "maintenance",
      image: {
        kind: "snapshot",
        imageId: sandboxProfileVersion.snapshotImageId,
      },
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

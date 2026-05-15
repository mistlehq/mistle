import { randomUUID } from "node:crypto";

import {
  getControlPlaneDatabaseSchema,
  type SandboxProfileVersionAgentRuntimeId,
} from "@mistle/db/control-plane";
import {
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  type SandboxInstanceSource,
  type SandboxInstanceStarterKind,
} from "@mistle/db/data-plane";
import { and, eq } from "drizzle-orm";

import { compileProfileVersionRuntimePlan } from "../compile-profile-version-runtime-plan.js";
import {
  SandboxProfilesBadRequestCodes,
  SandboxProfilesBadRequestError,
  SandboxProfilesCompileError,
  SandboxProfilesCompileErrorCodes,
} from "../errors.js";
import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "../errors.js";
import {
  createWorkflowSandboxRuntime,
  mapProfileVersionRuntimeConfig,
  type SandboxProfileVersionResources,
  validateSandboxProfileVersionRuntimeConfig,
} from "./profile-version-runtime-config.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type StartProfileSetupSandboxInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  purpose:
    | typeof SandboxInstancePurposes.SETUP_ASSISTANT
    | typeof SandboxInstancePurposes.SETUP_CHECK;
  agentRuntimeId?: SandboxProfileVersionAgentRuntimeId;
  setupScript?: string;
  snapshotPreparationScriptKind?: "setup" | "maintenance";
  image?: {
    kind: "base" | "snapshot";
    imageId: string;
  };
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

type StartProfileSetupSandboxOutput = {
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
};

async function resolveSetupSandboxRuntimeConfig(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
  },
) {
  const tables = getControlPlaneDatabaseSchema(db);
  const [sandboxProfileVersion] = await db
    .select({
      profileId: tables.sandboxProfiles.id,
      sandboxProfileId: tables.sandboxProfileVersions.sandboxProfileId,
      sandboxProvider: tables.sandboxProfileVersions.sandboxProvider,
      sandboxConnectionId: tables.sandboxProfileVersions.sandboxConnectionId,
      sandboxVcpuCount: tables.sandboxProfileVersions.sandboxVcpuCount,
      sandboxMemoryMb: tables.sandboxProfileVersions.sandboxMemoryMb,
      sandboxStorageMb: tables.sandboxProfileVersions.sandboxStorageMb,
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

  return mapProfileVersionRuntimeConfig(sandboxProfileVersion);
}

export async function startProfileSetupSandbox(
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
  input: StartProfileSetupSandboxInput,
): Promise<StartProfileSetupSandboxOutput> {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const persistedSandboxRuntimeConfig = await resolveSetupSandboxRuntimeConfig(
    {
      db,
    },
    {
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
    },
  );
  const sandboxRuntimeConfig = input.sandboxRuntimeConfig ?? persistedSandboxRuntimeConfig;
  if (input.sandboxRuntimeConfig !== undefined) {
    const runtimeConfigIssues = await validateSandboxProfileVersionRuntimeConfig(
      {
        db,
        integrationRegistry,
        sandboxConfig,
      },
      {
        organizationId: input.organizationId,
        runtimeConfig: sandboxRuntimeConfig,
      },
    );
    if (runtimeConfigIssues.length > 0) {
      const firstIssue = runtimeConfigIssues[0];
      if (firstIssue === undefined) {
        throw new Error("Expected sandbox runtime validation issue.");
      }

      throw new SandboxProfilesBadRequestError(
        SandboxProfilesBadRequestCodes.INVALID_SANDBOX_RUNTIME_CONFIG,
        firstIssue.message,
      );
    }
  }
  const sandboxRuntime = createWorkflowSandboxRuntime(sandboxRuntimeConfig);
  const compiledRuntimePlan = await compileProfileVersionRuntimePlan(
    {
      db,
      integrationsConfig,
    },
    {
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      ...(input.agentRuntimeId === undefined ? {} : { agentRuntimeId: input.agentRuntimeId }),
      ...(input.snapshotPreparationScriptKind === undefined
        ? {}
        : { snapshotPreparationScriptKind: input.snapshotPreparationScriptKind }),
      image: {
        source: input.image?.kind ?? "base",
        imageRef: input.image?.imageId ?? defaultBaseImage,
      },
    },
  );
  if (compiledRuntimePlan.agentRuntimes.length === 0) {
    throw new SandboxProfilesCompileError(
      SandboxProfilesCompileErrorCodes.AGENT_RUNTIME_REQUIRED,
      `Sandbox profile '${input.profileId}' version ${String(input.profileVersion)} does not declare an agent runtime. Add an agent integration binding before starting this setup sandbox.`,
    );
  }
  const { setupScript: _compiledSetupScript, ...runtimePlanWithoutSetupScript } =
    compiledRuntimePlan;
  const runtimePlan =
    input.setupScript === undefined
      ? runtimePlanWithoutSetupScript
      : {
          ...runtimePlanWithoutSetupScript,
          setupScript: input.setupScript,
        };

  const startedSandbox = await dataPlaneClient.startSandboxInstance({
    organizationId: input.organizationId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.profileVersion,
    persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
    purpose: input.purpose,
    idempotencyKey,
    runtimePlan,
    startedBy: input.startedBy,
    source: input.source,
    image: {
      imageId: input.image?.imageId ?? defaultBaseImage,
      createdAt: new Date().toISOString(),
      kind: input.image?.kind ?? "base",
      provider: sandboxRuntime.provider,
    },
    sandboxRuntime,
  });

  return {
    status: startedSandbox.status,
    workflowRunId: startedSandbox.workflowRunId,
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
  };
}

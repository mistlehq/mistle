import { randomUUID } from "node:crypto";

import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import {
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  type SandboxInstanceSource,
} from "@mistle/db/data-plane";
import { type SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import { and, eq } from "drizzle-orm";

import { compileProfileVersionRuntimePlan } from "../compile-profile-version-runtime-plan.js";
import { SandboxProfilesCompileError, SandboxProfilesCompileErrorCodes } from "../errors.js";
import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "../errors.js";
import {
  createWorkflowSandboxRuntime,
  mapProfileVersionRuntimeConfig,
} from "./profile-version-runtime-config.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type StartProfileSetupCheckSandboxInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  idempotencyKey?: string;
  requireAgentRuntime: boolean;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  source: SandboxInstanceSource;
};

type StartProfileSetupCheckSandboxOutput = {
  status: "accepted";
  workflowRunId: string;
  sandboxInstanceId: string;
};

async function resolveSetupCheckSandboxRuntime(
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

  return createWorkflowSandboxRuntime(mapProfileVersionRuntimeConfig(sandboxProfileVersion));
}

export async function startProfileSetupCheckSandbox(
  {
    db,
    integrationsConfig,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationsConfig" | "dataPlaneClient"> & {
    defaultBaseImage: string;
  },
  input: StartProfileSetupCheckSandboxInput,
): Promise<StartProfileSetupCheckSandboxOutput> {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const sandboxRuntime = await resolveSetupCheckSandboxRuntime(
    {
      db,
    },
    {
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
    },
  );
  const compiledRuntimePlan = await compileProfileVersionRuntimePlan(
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
  if (input.requireAgentRuntime === true && compiledRuntimePlan.agentRuntimes.length === 0) {
    throw new SandboxProfilesCompileError(
      SandboxProfilesCompileErrorCodes.AGENT_RUNTIME_REQUIRED,
      `Sandbox profile '${input.profileId}' version ${String(input.profileVersion)} does not declare an agent runtime. Add an agent integration binding before starting the Setup Assistant.`,
    );
  }
  const { setupScript: _setupScript, ...runtimePlanWithoutSetupScript } = compiledRuntimePlan;

  const startedSandbox = await dataPlaneClient.startSandboxInstance({
    organizationId: input.organizationId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.profileVersion,
    persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
    purpose: SandboxInstancePurposes.SETUP_CHECK,
    idempotencyKey,
    runtimePlan: runtimePlanWithoutSetupScript,
    startedBy: input.startedBy,
    source: input.source,
    image: {
      imageId: defaultBaseImage,
      createdAt: new Date().toISOString(),
      kind: "base",
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

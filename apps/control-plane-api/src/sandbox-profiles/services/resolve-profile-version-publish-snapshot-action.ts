import type {
  ControlPlaneDatabase,
  ControlPlaneTransaction,
  SandboxProfileVersionAgentRuntimeId,
} from "@mistle/db/control-plane";
import type { CompiledRuntimePlan, ResolvedSandboxImage } from "@mistle/integrations-core";

import { compileProfileVersionRuntimePlan } from "../compile-profile-version-runtime-plan.js";
import type { SandboxProfileVersionSkillsConfig } from "./profile-version-skills-config.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type PublishSnapshotAction =
  | {
      kind: "create";
    }
  | {
      kind: "reuse";
      snapshotImageProvider: string;
      snapshotImageId: string;
    };

type ProfileVersionSnapshotDecisionFields = {
  version: number;
  setupScript: string | null;
  agentRuntimeId: SandboxProfileVersionAgentRuntimeId;
  gitCommitSigningIntegrationConnectionId: string | null;
  mistleMcpEnabled: boolean;
  mistleMcpApiKeyId: string | null;
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxDiskMb: number | null;
  skillsConfig: SandboxProfileVersionSkillsConfig | null;
  snapshotImageProvider: string | null;
  snapshotImageId: string | null;
};

type SnapshotSensitiveRuntimePlan = Omit<
  CompiledRuntimePlan,
  "egressRoutes" | "setupScript" | "skills" | "version"
> & {
  skillsOriginUrl: string | null;
};

type ResolveProfileVersionPublishSnapshotActionInput = {
  organizationId: string;
  profileId: string;
  draftVersion: ProfileVersionSnapshotDecisionFields;
  previousActiveVersion: ProfileVersionSnapshotDecisionFields | null;
};

function normalizeSnapshotPreparationScript(script: string | null): string | null {
  if (script === null || script.trim().length === 0) {
    return null;
  }

  return script;
}

function normalizeSkillsConfigForSnapshotDecision(
  skillsConfig: SandboxProfileVersionSkillsConfig | null,
): string | null {
  if (skillsConfig === null) {
    return null;
  }

  return JSON.stringify({
    originUrl: skillsConfig.originUrl,
    selectedSkills: skillsConfig.selectedSkills.map((skill) => ({
      name: skill.name,
      relativePath: skill.relativePath,
    })),
  });
}

function profileVersionsDifferOnSnapshotRequiredFields(input: {
  previous: ProfileVersionSnapshotDecisionFields;
  draft: ProfileVersionSnapshotDecisionFields;
}): boolean {
  return (
    normalizeSnapshotPreparationScript(input.previous.setupScript) !==
      normalizeSnapshotPreparationScript(input.draft.setupScript) ||
    input.previous.agentRuntimeId !== input.draft.agentRuntimeId ||
    input.previous.sandboxProvider !== input.draft.sandboxProvider ||
    input.previous.sandboxConnectionId !== input.draft.sandboxConnectionId ||
    input.previous.sandboxVcpuCount !== input.draft.sandboxVcpuCount ||
    input.previous.sandboxMemoryMb !== input.draft.sandboxMemoryMb ||
    input.previous.sandboxDiskMb !== input.draft.sandboxDiskMb ||
    normalizeSkillsConfigForSnapshotDecision(input.previous.skillsConfig) !==
      normalizeSkillsConfigForSnapshotDecision(input.draft.skillsConfig)
  );
}

function runtimePlanSnapshotImpact(runtimePlan: CompiledRuntimePlan): SnapshotSensitiveRuntimePlan {
  const {
    egressRoutes: _egressRoutes,
    setupScript: _setupScript,
    skills,
    version: _version,
    ...snapshotSensitiveRuntimePlan
  } = runtimePlan;

  return {
    ...snapshotSensitiveRuntimePlan,
    skillsOriginUrl: skills?.originUrl ?? null,
  };
}

function runtimePlanSnapshotImpactMatches(input: {
  previousRuntimePlan: CompiledRuntimePlan;
  draftRuntimePlan: CompiledRuntimePlan;
}): boolean {
  return (
    JSON.stringify(runtimePlanSnapshotImpact(input.previousRuntimePlan)) ===
    JSON.stringify(runtimePlanSnapshotImpact(input.draftRuntimePlan))
  );
}

async function compileRuntimePlanForSnapshotReuseDecision(
  {
    db,
    integrationsConfig,
    mcpConfig,
  }: Pick<CreateSandboxProfilesServiceInput, "integrationsConfig" | "mcpConfig"> & {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
    image: ResolvedSandboxImage;
  },
): Promise<CompiledRuntimePlan> {
  return await compileProfileVersionRuntimePlan(
    {
      db,
      integrationsConfig,
      mcpConfig,
    },
    input,
  );
}

export async function resolveProfileVersionPublishSnapshotAction(
  {
    db,
    integrationsConfig,
    mcpConfig,
  }: Pick<CreateSandboxProfilesServiceInput, "integrationsConfig" | "mcpConfig"> & {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: ResolveProfileVersionPublishSnapshotActionInput,
): Promise<PublishSnapshotAction> {
  const previousActiveVersion = input.previousActiveVersion;
  if (
    previousActiveVersion === null ||
    previousActiveVersion.snapshotImageProvider === null ||
    previousActiveVersion.snapshotImageId === null
  ) {
    return { kind: "create" };
  }

  if (
    profileVersionsDifferOnSnapshotRequiredFields({
      previous: previousActiveVersion,
      draft: input.draftVersion,
    })
  ) {
    return { kind: "create" };
  }

  const image: ResolvedSandboxImage = {
    source: "snapshot",
    imageRef: previousActiveVersion.snapshotImageId,
  };
  const [previousRuntimePlan, draftRuntimePlan] = await Promise.all([
    compileRuntimePlanForSnapshotReuseDecision(
      {
        db,
        integrationsConfig,
        mcpConfig,
      },
      {
        organizationId: input.organizationId,
        profileId: input.profileId,
        profileVersion: previousActiveVersion.version,
        image,
      },
    ),
    compileRuntimePlanForSnapshotReuseDecision(
      {
        db,
        integrationsConfig,
        mcpConfig,
      },
      {
        organizationId: input.organizationId,
        profileId: input.profileId,
        profileVersion: input.draftVersion.version,
        image,
      },
    ),
  ]);

  if (
    !runtimePlanSnapshotImpactMatches({
      previousRuntimePlan,
      draftRuntimePlan,
    })
  ) {
    return { kind: "create" };
  }

  return {
    kind: "reuse",
    snapshotImageProvider: previousActiveVersion.snapshotImageProvider,
    snapshotImageId: previousActiveVersion.snapshotImageId,
  };
}

export type {
  ProfileVersionSnapshotDecisionFields,
  PublishSnapshotAction,
  ResolveProfileVersionPublishSnapshotActionInput,
};

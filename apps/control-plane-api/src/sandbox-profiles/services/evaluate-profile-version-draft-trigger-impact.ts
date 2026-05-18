import type { TriggerKind, ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  TriggerKinds,
  getControlPlaneDatabaseSchema,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import {
  agentDefinitionAllowsRuntime,
  createAgentProviderKey,
  createDefinitionsBundle,
  resolvePrimaryConversationIntegrationFamilyId,
} from "@mistle/integrations-definitions/server";
import { and, eq } from "drizzle-orm";

import {
  SandboxProfileTriggerImpactIssueCodes,
  type SandboxProfileTriggerImpactIssueCode,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { listProfileVersionRepositoryOptions } from "./repository-options.js";

const Definitions = createDefinitionsBundle();
const IntegrationRegistry = Definitions.integrationRegistry;

type TriggerImpactIssue = {
  code: SandboxProfileTriggerImpactIssueCode;
  message: string;
  bindingId?: string;
  connectionId?: string;
  targetKey?: string;
  primaryRepositoryId?: string;
};

type TriggerImpactTrigger = {
  id: string;
  name: string;
  kind: TriggerKind;
  enabled: boolean;
  issues: TriggerImpactIssue[];
};

type EvaluateProfileVersionDraftTriggerImpactInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

type EvaluateProfileVersionDraftTriggerImpactOutput = {
  hasBreakingChanges: boolean;
  affectedTriggers: TriggerImpactTrigger[];
};

async function assertProfileVersionExists(
  db: ControlPlaneDatabase,
  input: EvaluateProfileVersionDraftTriggerImpactInput,
): Promise<void> {
  const sandboxProfile = await db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.profileId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (sandboxProfile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  const sandboxProfileVersion = await db.query.sandboxProfileVersions.findFirst({
    columns: {
      version: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.sandboxProfileId, input.profileId),
        whereEq(table.version, input.profileVersion),
      ),
  });

  if (sandboxProfileVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }
}

async function resolveProfileVersionAgentIssues(
  db: ControlPlaneDatabase,
  input: EvaluateProfileVersionDraftTriggerImpactInput,
): Promise<TriggerImpactIssue[]> {
  const profileVersion = await db.query.sandboxProfileVersions.findFirst({
    columns: {
      agentRuntimeId: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.sandboxProfileId, input.profileId),
        whereEq(table.version, input.profileVersion),
      ),
  });
  if (profileVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }

  const agentBindings = await db.query.sandboxProfileVersionIntegrationBindings.findMany({
    columns: {
      id: true,
      connectionId: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.sandboxProfileId, input.profileId),
        whereEq(table.sandboxProfileVersion, input.profileVersion),
        whereEq(table.kind, IntegrationBindingKinds.AGENT),
      ),
    orderBy: (table, { asc }) => [asc(table.id)],
  });

  const agentBinding = agentBindings[0];
  if (agentBinding === undefined) {
    return [
      {
        code: SandboxProfileTriggerImpactIssueCodes.AGENT_BINDING_REQUIRED,
        message: `Sandbox profile version '${String(input.profileVersion)}' must have at least one agent binding for triggers to run.`,
      },
    ];
  }

  const issues: TriggerImpactIssue[] = [];
  const providerBindingIds = new Map<string, string>();
  const primaryIntegrationFamilyId = resolvePrimaryConversationIntegrationFamilyId(
    profileVersion.agentRuntimeId,
  );
  let hasPrimaryIntegrationFamily = primaryIntegrationFamilyId === null;

  for (const binding of agentBindings) {
    const agentConnection = await db.query.integrationConnections.findFirst({
      columns: {
        id: true,
        status: true,
        targetKey: true,
      },
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.id, binding.connectionId),
          whereEq(table.organizationId, input.organizationId),
        ),
    });

    if (agentConnection === undefined) {
      issues.push({
        code: SandboxProfileTriggerImpactIssueCodes.INVALID_BINDING_CONNECTION_REFERENCE,
        message: `Agent binding '${binding.id}' references connection '${binding.connectionId}' that is missing or inaccessible.`,
        bindingId: binding.id,
        connectionId: binding.connectionId,
      });
      continue;
    }

    if (agentConnection.status !== IntegrationConnectionStatuses.ACTIVE) {
      issues.push({
        code: SandboxProfileTriggerImpactIssueCodes.CONNECTION_NOT_ACTIVE,
        message: `Agent binding '${binding.id}' references connection '${agentConnection.id}' that is not active.`,
        bindingId: binding.id,
        connectionId: agentConnection.id,
      });
      continue;
    }

    const agentTarget = await db.query.integrationTargets.findFirst({
      columns: {
        enabled: true,
        familyId: true,
        targetKey: true,
        variantId: true,
      },
      where: (table, { eq: whereEq }) => whereEq(table.targetKey, agentConnection.targetKey),
    });

    if (agentTarget === undefined) {
      issues.push({
        code: SandboxProfileTriggerImpactIssueCodes.TARGET_MISSING,
        message: `Agent connection '${agentConnection.id}' references target '${agentConnection.targetKey}' that is missing.`,
        bindingId: binding.id,
        connectionId: agentConnection.id,
        targetKey: agentConnection.targetKey,
      });
      continue;
    }

    if (!agentTarget.enabled) {
      issues.push({
        code: SandboxProfileTriggerImpactIssueCodes.TARGET_DISABLED,
        message: `Agent binding '${binding.id}' references disabled target '${agentTarget.targetKey}'.`,
        bindingId: binding.id,
        connectionId: agentConnection.id,
        targetKey: agentTarget.targetKey,
      });
      continue;
    }

    const agentDefinition = IntegrationRegistry.getDefinition({
      familyId: agentTarget.familyId,
      variantId: agentTarget.variantId,
    });
    if (
      !agentDefinitionAllowsRuntime({
        definition: agentDefinition,
        runtimeId: profileVersion.agentRuntimeId,
      })
    ) {
      issues.push({
        code: SandboxProfileTriggerImpactIssueCodes.AGENT_BINDING_RUNTIME_INCOMPATIBLE,
        message: `Agent binding '${binding.id}' references provider '${agentTarget.familyId}' that is not compatible with runtime '${profileVersion.agentRuntimeId}'.`,
        bindingId: binding.id,
        connectionId: agentConnection.id,
        targetKey: agentTarget.targetKey,
      });
      continue;
    }

    const providerKey = createAgentProviderKey({
      familyId: agentTarget.familyId,
      variantId: agentTarget.variantId,
    });
    const firstBindingId = providerBindingIds.get(providerKey);
    if (firstBindingId !== undefined) {
      issues.push({
        code: SandboxProfileTriggerImpactIssueCodes.AGENT_BINDING_AMBIGUOUS,
        message: `Agent binding '${binding.id}' duplicates provider '${agentTarget.familyId}' already bound by '${firstBindingId}'.`,
        bindingId: binding.id,
        connectionId: agentConnection.id,
        targetKey: agentTarget.targetKey,
      });
      continue;
    }
    providerBindingIds.set(providerKey, binding.id);
    if (agentTarget.familyId === primaryIntegrationFamilyId) {
      hasPrimaryIntegrationFamily = true;
    }
  }

  if (primaryIntegrationFamilyId !== null && !hasPrimaryIntegrationFamily) {
    issues.push({
      code: SandboxProfileTriggerImpactIssueCodes.AGENT_BINDING_PRIMARY_REQUIRED,
      message: `Sandbox profile version '${String(input.profileVersion)}' must have an agent binding for provider '${primaryIntegrationFamilyId}' to run triggers with runtime '${profileVersion.agentRuntimeId}'.`,
    });
  }

  return issues;
}

async function loadTriggerTargetRows(
  db: ControlPlaneDatabase,
  input: EvaluateProfileVersionDraftTriggerImpactInput,
) {
  const tables = getControlPlaneDatabaseSchema(db);

  return await db
    .select({
      triggerId: tables.triggers.id,
      triggerName: tables.triggers.name,
      triggerKind: tables.triggers.kind,
      triggerEnabled: tables.triggers.enabled,
      primaryRepositoryId: tables.triggerTargets.primaryRepositoryId,
      webhookSourceConnectionId: tables.integrationWebhookSources.integrationConnectionId,
    })
    .from(tables.triggerTargets)
    .innerJoin(tables.triggers, eq(tables.triggers.id, tables.triggerTargets.triggerId))
    .leftJoin(tables.webhookTriggers, eq(tables.webhookTriggers.triggerId, tables.triggers.id))
    .leftJoin(
      tables.integrationWebhookSources,
      eq(tables.integrationWebhookSources.id, tables.webhookTriggers.integrationWebhookSourceId),
    )
    .where(
      and(
        eq(tables.triggerTargets.sandboxProfileId, input.profileId),
        eq(tables.triggers.organizationId, input.organizationId),
      ),
    )
    .orderBy(tables.triggers.name, tables.triggers.id);
}

export async function evaluateProfileVersionDraftTriggerImpact(
  { db }: { db: ControlPlaneDatabase },
  input: EvaluateProfileVersionDraftTriggerImpactInput,
): Promise<EvaluateProfileVersionDraftTriggerImpactOutput> {
  await assertProfileVersionExists(db, input);

  const [agentIssues, triggerTargetRows, bindings, repositoryOptions] = await Promise.all([
    resolveProfileVersionAgentIssues(db, input),
    loadTriggerTargetRows(db, input),
    db.query.sandboxProfileVersionIntegrationBindings.findMany({
      columns: {
        connectionId: true,
      },
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.sandboxProfileId, input.profileId),
          whereEq(table.sandboxProfileVersion, input.profileVersion),
        ),
    }),
    listProfileVersionRepositoryOptions(
      {
        db,
      },
      {
        organizationId: input.organizationId,
        profileId: input.profileId,
        profileVersion: input.profileVersion,
      },
    ),
  ]);

  const boundConnectionIds = new Set(bindings.map((binding) => binding.connectionId));
  const repositoryOptionIds = new Set(repositoryOptions.map((option) => option.id));
  const affectedTriggers: TriggerImpactTrigger[] = [];

  for (const trigger of triggerTargetRows) {
    const issues = [...agentIssues];

    if (
      trigger.triggerKind === TriggerKinds.WEBHOOK &&
      trigger.webhookSourceConnectionId !== null &&
      !boundConnectionIds.has(trigger.webhookSourceConnectionId)
    ) {
      issues.push({
        code: SandboxProfileTriggerImpactIssueCodes.WEBHOOK_SOURCE_CONNECTION_NOT_BOUND,
        message: `Webhook trigger '${trigger.triggerName}' uses connection '${trigger.webhookSourceConnectionId}', but the draft does not bind that connection.`,
        connectionId: trigger.webhookSourceConnectionId,
      });
    }

    if (
      trigger.primaryRepositoryId !== null &&
      !repositoryOptionIds.has(trigger.primaryRepositoryId)
    ) {
      issues.push({
        code: SandboxProfileTriggerImpactIssueCodes.PRIMARY_REPOSITORY_UNAVAILABLE,
        message: `Trigger '${trigger.triggerName}' uses primary repository '${trigger.primaryRepositoryId}', but that repository is not available in the draft.`,
        primaryRepositoryId: trigger.primaryRepositoryId,
      });
    }

    if (issues.length > 0) {
      affectedTriggers.push({
        id: trigger.triggerId,
        name: trigger.triggerName,
        kind: trigger.triggerKind,
        enabled: trigger.triggerEnabled,
        issues,
      });
    }
  }

  return {
    hasBreakingChanges: affectedTriggers.length > 0,
    affectedTriggers,
  };
}

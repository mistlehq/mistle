import type { AutomationKind, ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  AutomationKinds,
  getControlPlaneDatabaseSchema,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import {
  SandboxProfileAutomationImpactIssueCodes,
  type SandboxProfileAutomationImpactIssueCode,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { listProfileVersionRepositoryOptions } from "./repository-options.js";

type AutomationImpactIssue = {
  code: SandboxProfileAutomationImpactIssueCode;
  message: string;
  bindingId?: string;
  connectionId?: string;
  targetKey?: string;
  primaryRepositoryId?: string;
};

type AutomationImpactAutomation = {
  id: string;
  name: string;
  kind: AutomationKind;
  enabled: boolean;
  issues: AutomationImpactIssue[];
};

type EvaluateProfileVersionDraftAutomationImpactInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

type EvaluateProfileVersionDraftAutomationImpactOutput = {
  hasBreakingChanges: boolean;
  affectedAutomations: AutomationImpactAutomation[];
};

async function assertProfileVersionExists(
  db: ControlPlaneDatabase,
  input: EvaluateProfileVersionDraftAutomationImpactInput,
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
  input: EvaluateProfileVersionDraftAutomationImpactInput,
): Promise<AutomationImpactIssue[]> {
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
        code: SandboxProfileAutomationImpactIssueCodes.AGENT_BINDING_REQUIRED,
        message: `Sandbox profile version '${String(input.profileVersion)}' must have exactly one agent binding for automations to run.`,
      },
    ];
  }

  if (agentBindings[1] !== undefined) {
    return [
      {
        code: SandboxProfileAutomationImpactIssueCodes.AGENT_BINDING_AMBIGUOUS,
        message: `Sandbox profile version '${String(input.profileVersion)}' has multiple agent bindings, but automations require exactly one.`,
      },
    ];
  }

  const agentConnection = await db.query.integrationConnections.findFirst({
    columns: {
      id: true,
      status: true,
      targetKey: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, agentBinding.connectionId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (agentConnection === undefined) {
    return [
      {
        code: SandboxProfileAutomationImpactIssueCodes.INVALID_BINDING_CONNECTION_REFERENCE,
        message: `Agent binding '${agentBinding.id}' references connection '${agentBinding.connectionId}' that is missing or inaccessible.`,
        bindingId: agentBinding.id,
        connectionId: agentBinding.connectionId,
      },
    ];
  }

  if (agentConnection.status !== IntegrationConnectionStatuses.ACTIVE) {
    return [
      {
        code: SandboxProfileAutomationImpactIssueCodes.CONNECTION_NOT_ACTIVE,
        message: `Agent binding '${agentBinding.id}' references connection '${agentConnection.id}' that is not active.`,
        bindingId: agentBinding.id,
        connectionId: agentConnection.id,
      },
    ];
  }

  const agentTarget = await db.query.integrationTargets.findFirst({
    columns: {
      enabled: true,
      targetKey: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.targetKey, agentConnection.targetKey),
  });

  if (agentTarget === undefined) {
    return [
      {
        code: SandboxProfileAutomationImpactIssueCodes.TARGET_MISSING,
        message: `Agent connection '${agentConnection.id}' references target '${agentConnection.targetKey}' that is missing.`,
        bindingId: agentBinding.id,
        connectionId: agentConnection.id,
        targetKey: agentConnection.targetKey,
      },
    ];
  }

  if (!agentTarget.enabled) {
    return [
      {
        code: SandboxProfileAutomationImpactIssueCodes.TARGET_DISABLED,
        message: `Agent binding '${agentBinding.id}' references disabled target '${agentTarget.targetKey}'.`,
        bindingId: agentBinding.id,
        connectionId: agentConnection.id,
        targetKey: agentTarget.targetKey,
      },
    ];
  }

  return [];
}

async function loadAutomationTargetRows(
  db: ControlPlaneDatabase,
  input: EvaluateProfileVersionDraftAutomationImpactInput,
) {
  const tables = getControlPlaneDatabaseSchema(db);

  return await db
    .select({
      automationId: tables.automations.id,
      automationName: tables.automations.name,
      automationKind: tables.automations.kind,
      automationEnabled: tables.automations.enabled,
      primaryRepositoryId: tables.automationTargets.primaryRepositoryId,
      webhookSourceConnectionId: tables.integrationWebhookSources.integrationConnectionId,
    })
    .from(tables.automationTargets)
    .innerJoin(tables.automations, eq(tables.automations.id, tables.automationTargets.automationId))
    .leftJoin(
      tables.webhookAutomations,
      eq(tables.webhookAutomations.automationId, tables.automations.id),
    )
    .leftJoin(
      tables.integrationWebhookSources,
      eq(tables.integrationWebhookSources.id, tables.webhookAutomations.integrationWebhookSourceId),
    )
    .where(
      and(
        eq(tables.automationTargets.sandboxProfileId, input.profileId),
        eq(tables.automations.organizationId, input.organizationId),
      ),
    )
    .orderBy(tables.automations.name, tables.automations.id);
}

export async function evaluateProfileVersionDraftAutomationImpact(
  { db }: { db: ControlPlaneDatabase },
  input: EvaluateProfileVersionDraftAutomationImpactInput,
): Promise<EvaluateProfileVersionDraftAutomationImpactOutput> {
  await assertProfileVersionExists(db, input);

  const [agentIssues, automationTargetRows, bindings, repositoryOptions] = await Promise.all([
    resolveProfileVersionAgentIssues(db, input),
    loadAutomationTargetRows(db, input),
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
  const affectedAutomations: AutomationImpactAutomation[] = [];

  for (const automation of automationTargetRows) {
    const issues = [...agentIssues];

    if (
      automation.automationKind === AutomationKinds.WEBHOOK &&
      automation.webhookSourceConnectionId !== null &&
      !boundConnectionIds.has(automation.webhookSourceConnectionId)
    ) {
      issues.push({
        code: SandboxProfileAutomationImpactIssueCodes.WEBHOOK_SOURCE_CONNECTION_NOT_BOUND,
        message: `Webhook automation '${automation.automationName}' uses connection '${automation.webhookSourceConnectionId}', but the draft does not bind that connection.`,
        connectionId: automation.webhookSourceConnectionId,
      });
    }

    if (
      automation.primaryRepositoryId !== null &&
      !repositoryOptionIds.has(automation.primaryRepositoryId)
    ) {
      issues.push({
        code: SandboxProfileAutomationImpactIssueCodes.PRIMARY_REPOSITORY_UNAVAILABLE,
        message: `Automation '${automation.automationName}' uses primary repository '${automation.primaryRepositoryId}', but that repository is not available in the draft.`,
        primaryRepositoryId: automation.primaryRepositoryId,
      });
    }

    if (issues.length > 0) {
      affectedAutomations.push({
        id: automation.automationId,
        name: automation.automationName,
        kind: automation.automationKind,
        enabled: automation.automationEnabled,
        issues,
      });
    }
  }

  return {
    hasBreakingChanges: affectedAutomations.length > 0,
    affectedAutomations,
  };
}

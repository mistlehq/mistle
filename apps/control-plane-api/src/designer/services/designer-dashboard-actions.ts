import {
  type ControlPlaneDatabase,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  type IntegrationBindingKind,
} from "@mistle/db/control-plane";
import {
  IntegrationResourceSelectionModes,
  type IntegrationRegistry,
} from "@mistle/integrations-core";
import { createProviderResourceBindingIntentId } from "@mistle/integrations-definitions/server";

import { putProfileVersionDraft } from "../../sandbox-profiles/services/put-profile-version-draft.js";
import type { ControlPlaneApiSandboxRuntimeConfig } from "../../types.js";
import {
  DesignerBadRequestCodes,
  DesignerBadRequestError,
  DesignerNotFoundCodes,
  DesignerNotFoundError,
} from "../errors.js";
import type {
  SaveDesignerSelectedProviderResourcesBody,
  SaveDesignerSelectedProviderResourcesResponse,
} from "../schemas.js";

type DesignerDashboardActionsContext = {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
};

type SaveDesignerSelectedProviderResourcesInput = {
  organizationId: string;
  sessionId: string;
  body: SaveDesignerSelectedProviderResourcesBody;
};

function toIntegrationBindingKind(kind: string): IntegrationBindingKind {
  if (kind === IntegrationBindingKinds.AGENT) {
    return IntegrationBindingKinds.AGENT;
  }
  if (kind === IntegrationBindingKinds.GIT) {
    return IntegrationBindingKinds.GIT;
  }
  if (kind === IntegrationBindingKinds.CONNECTOR) {
    return IntegrationBindingKinds.CONNECTOR;
  }
  if (kind === IntegrationBindingKinds.SANDBOX) {
    return IntegrationBindingKinds.SANDBOX;
  }

  throw new DesignerBadRequestError(
    DesignerBadRequestCodes.DESIGNER_DASHBOARD_ACTION_INVALID_INPUT,
    `Binding intent cannot target unsupported integration kind '${kind}'.`,
  );
}

function createBindingFieldValue(input: {
  selectionMode: string;
  selectedHandles: readonly string[];
}): string | readonly string[] {
  if (input.selectionMode === IntegrationResourceSelectionModes.SINGLE) {
    const selectedHandle = input.selectedHandles[0];
    if (input.selectedHandles.length > 1) {
      throw new DesignerBadRequestError(
        DesignerBadRequestCodes.DESIGNER_DASHBOARD_ACTION_INVALID_INPUT,
        "Selected provider resource count is invalid for a single-select binding intent.",
      );
    }

    return selectedHandle ?? "";
  }

  if (input.selectionMode !== IntegrationResourceSelectionModes.MULTI) {
    throw new DesignerBadRequestError(
      DesignerBadRequestCodes.DESIGNER_DASHBOARD_ACTION_INVALID_INPUT,
      `Provider resource selection mode '${input.selectionMode}' is not supported.`,
    );
  }

  return [...input.selectedHandles];
}

export async function saveDesignerSelectedProviderResources(
  { db, integrationRegistry, sandboxConfig }: DesignerDashboardActionsContext,
  input: SaveDesignerSelectedProviderResourcesInput,
): Promise<SaveDesignerSelectedProviderResourcesResponse> {
  const designerSession = await db.query.designerSessions.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.sessionId), eq(table.organizationId, input.organizationId)),
  });
  if (designerSession === undefined) {
    throw new DesignerNotFoundError(
      DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND,
      `Designer session '${input.sessionId}' was not found.`,
    );
  }

  const connection = await db.query.integrationConnections.findFirst({
    columns: {
      id: true,
      status: true,
      targetKey: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.body.connectionId), eq(table.organizationId, input.organizationId)),
  });
  if (connection === undefined || connection.status !== IntegrationConnectionStatuses.ACTIVE) {
    throw new DesignerBadRequestError(
      DesignerBadRequestCodes.DESIGNER_DASHBOARD_ACTION_INVALID_INPUT,
      `Integration connection '${input.body.connectionId}' is missing or inactive.`,
    );
  }

  const target = await db.query.integrationTargets.findFirst({
    columns: {
      familyId: true,
      variantId: true,
    },
    where: (table, { eq }) => eq(table.targetKey, connection.targetKey),
  });
  if (target === undefined) {
    throw new DesignerBadRequestError(
      DesignerBadRequestCodes.DESIGNER_DASHBOARD_ACTION_INVALID_INPUT,
      `Integration target '${connection.targetKey}' could not be resolved.`,
    );
  }

  const definition = integrationRegistry.getDefinitionOrThrow({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  const resourceDefinition = definition.resourceDefinitions?.find(
    (candidate) => candidate.kind === input.body.resourceKind,
  );
  if (resourceDefinition === undefined) {
    throw new DesignerBadRequestError(
      DesignerBadRequestCodes.DESIGNER_DASHBOARD_ACTION_INVALID_INPUT,
      `Provider resource kind '${input.body.resourceKind}' is not supported by '${connection.targetKey}'.`,
    );
  }

  const expectedBindingIntent = createProviderResourceBindingIntentId({
    bindingKind: definition.kind,
    bindingField: resourceDefinition.bindingField,
  });
  if (input.body.bindingIntent !== expectedBindingIntent) {
    throw new DesignerBadRequestError(
      DesignerBadRequestCodes.DESIGNER_DASHBOARD_ACTION_INVALID_INPUT,
      `Binding intent '${input.body.bindingIntent}' is not valid for provider resource kind '${input.body.resourceKind}'.`,
    );
  }

  const bindingKind = toIntegrationBindingKind(definition.kind);
  const selectedHandles = dedupeStrings(input.body.selectedHandles);
  const currentBindings = await db.query.sandboxProfileVersionIntegrationBindings.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.body.targetDraft.profileId),
        eq(table.sandboxProfileVersion, input.body.targetDraft.version),
      ),
    orderBy: (table, { asc }) => [asc(table.id)],
  });
  const targetBinding = currentBindings.find(
    (binding) => binding.connectionId === connection.id && binding.kind === bindingKind,
  );
  const createdBinding = targetBinding === undefined;
  const nextFieldValue = createBindingFieldValue({
    selectionMode: resourceDefinition.selectionMode,
    selectedHandles,
  });
  const nextTargetBinding = {
    ...(targetBinding === undefined ? {} : { id: targetBinding.id }),
    connectionId: connection.id,
    kind: bindingKind,
    config: {
      ...targetBinding?.config,
      [resourceDefinition.bindingField]: nextFieldValue,
    },
  };
  const nextBindings = [
    ...currentBindings
      .filter((binding) => binding.id !== targetBinding?.id)
      .map((binding) => ({
        id: binding.id,
        connectionId: binding.connectionId,
        kind: binding.kind,
        config: binding.config,
      })),
    nextTargetBinding,
  ];

  const savedDraft = await putProfileVersionDraft(
    { db, integrationRegistry, sandboxConfig },
    {
      organizationId: input.organizationId,
      profileId: input.body.targetDraft.profileId,
      profileVersion: input.body.targetDraft.version,
      integrationBindings: {
        bindings: nextBindings,
      },
    },
  );
  const savedBinding = savedDraft.integrationBindings.bindings.find(
    (binding) => binding.connectionId === connection.id && binding.kind === bindingKind,
  );
  if (savedBinding === undefined) {
    throw new Error("Expected saved provider resource binding to be returned.");
  }

  return {
    kind: "sandbox-profile-draft-provider-resources-saved",
    profileId: input.body.targetDraft.profileId,
    version: input.body.targetDraft.version,
    connectionId: connection.id,
    resourceKind: input.body.resourceKind,
    bindingIntent: input.body.bindingIntent,
    bindingId: savedBinding.id,
    selectedHandles,
    createdBinding,
  };
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}

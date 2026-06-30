import {
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionStates,
  type IntegrationBindingKind,
  type SandboxProfileVersionIntegrationBinding,
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
  const targetProfile = await db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.id, input.body.targetDraft.profileId),
        eq(table.organizationId, input.organizationId),
      ),
  });
  if (targetProfile === undefined) {
    throw new DesignerBadRequestError(
      DesignerBadRequestCodes.DESIGNER_DASHBOARD_ACTION_INVALID_INPUT,
      "Target sandbox profile draft was not found.",
    );
  }
  const targetVersion = await db.query.sandboxProfileVersions.findFirst({
    columns: {
      state: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.body.targetDraft.profileId),
        eq(table.version, input.body.targetDraft.version),
      ),
  });
  if (targetVersion === undefined) {
    throw new DesignerBadRequestError(
      DesignerBadRequestCodes.DESIGNER_DASHBOARD_ACTION_INVALID_INPUT,
      "Target sandbox profile draft was not found.",
    );
  }
  if (targetVersion.state !== SandboxProfileVersionStates.DRAFT) {
    throw new DesignerBadRequestError(
      DesignerBadRequestCodes.DESIGNER_DASHBOARD_ACTION_INVALID_INPUT,
      "Target sandbox profile version is not an editable draft.",
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

  const selectedTarget = await db.query.integrationTargets.findFirst({
    columns: {
      familyId: true,
      variantId: true,
    },
    where: (table, { eq }) => eq(table.targetKey, connection.targetKey),
  });
  if (selectedTarget === undefined) {
    throw new DesignerBadRequestError(
      DesignerBadRequestCodes.DESIGNER_DASHBOARD_ACTION_INVALID_INPUT,
      `Integration target '${connection.targetKey}' could not be resolved.`,
    );
  }

  const definition = integrationRegistry.getDefinitionOrThrow({
    familyId: selectedTarget.familyId,
    variantId: selectedTarget.variantId,
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

  const bindingKind: IntegrationBindingKind = definition.kind;
  const selectedHandles = dedupeStrings(input.body.selectedHandles);
  const nextFieldValue = createBindingFieldValue({
    selectionMode: resourceDefinition.selectionMode,
    selectedHandles,
  });
  let createdBinding: boolean | undefined;

  const savedDraft = await putProfileVersionDraft(
    { db, integrationRegistry, sandboxConfig },
    {
      organizationId: input.organizationId,
      profileId: input.body.targetDraft.profileId,
      profileVersion: input.body.targetDraft.version,
      integrationBindings: {
        mergeCurrentBindings: async ({ db: tx, currentBindings }) => {
          const targetBinding = await findProviderResourceTargetBinding(
            { db: tx, integrationRegistry },
            {
              organizationId: input.organizationId,
              bindings: currentBindings,
              bindingKind,
              familyId: selectedTarget.familyId,
              selectedConnectionId: connection.id,
            },
          );
          createdBinding = targetBinding === undefined;
          const nextTargetBinding = {
            ...(targetBinding === undefined ? {} : { id: targetBinding.id }),
            connectionId: connection.id,
            kind: bindingKind,
            config: {
              ...targetBinding?.config,
              [resourceDefinition.bindingField]: nextFieldValue,
            },
          };

          return [
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
        },
      },
    },
  );
  if (createdBinding === undefined) {
    throw new Error("Expected provider resource binding merge to run.");
  }
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

async function findProviderResourceTargetBinding(
  {
    db,
    integrationRegistry,
  }: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    bindings: readonly SandboxProfileVersionIntegrationBinding[];
    bindingKind: IntegrationBindingKind;
    familyId: string;
    selectedConnectionId: string;
  },
): Promise<SandboxProfileVersionIntegrationBinding | undefined> {
  const exactConnectionBinding = input.bindings.find(
    (binding) =>
      binding.kind === input.bindingKind && binding.connectionId === input.selectedConnectionId,
  );
  if (exactConnectionBinding !== undefined) {
    return exactConnectionBinding;
  }

  if (input.bindingKind !== IntegrationBindingKinds.GIT) {
    return undefined;
  }

  for (const binding of input.bindings) {
    if (binding.kind !== input.bindingKind) {
      continue;
    }

    const connection = await db.query.integrationConnections.findFirst({
      columns: {
        id: true,
        targetKey: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.id, binding.connectionId), eq(table.organizationId, input.organizationId)),
    });
    if (connection === undefined) {
      throw new DesignerBadRequestError(
        DesignerBadRequestCodes.DESIGNER_DASHBOARD_ACTION_INVALID_INPUT,
        `Existing integration binding '${binding.id}' references missing connection '${binding.connectionId}'.`,
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
        `Existing integration binding '${binding.id}' references unresolved target '${connection.targetKey}'.`,
      );
    }

    const definition = integrationRegistry.getDefinitionOrThrow({
      familyId: target.familyId,
      variantId: target.variantId,
    });
    if (definition.kind === input.bindingKind && target.familyId === input.familyId) {
      return binding;
    }
  }

  return undefined;
}

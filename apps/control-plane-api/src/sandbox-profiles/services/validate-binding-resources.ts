import {
  type IntegrationConnectionResource,
  type IntegrationConnectionResourceState,
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
} from "@mistle/db/control-plane";
import type { AnyIntegrationDefinition } from "@mistle/integrations-core";
import { IntegrationResourceSelectionModes } from "@mistle/integrations-core";

import type { CreateSandboxProfilesServiceInput } from "./types.js";

type BindingResourceValidationIssue = {
  bindingIdOrDraftIndex: string;
  clientRef?: string;
  validatorCode: string;
  field: string;
  safeMessage: string;
};

type BindingSelectionValidationInput = {
  bindingIdOrDraftIndex: string;
  clientRef?: string;
  bindingConfig: Record<string, unknown>;
  connectionId: string;
  definition: AnyIntegrationDefinition;
};

type PendingSelectionValidation = {
  bindingIdOrDraftIndex: string;
  clientRef?: string;
  connectionId: string;
  kind: string;
  field: string;
  displayNameSingular: string;
  displayNamePlural: string;
  selectedHandles: readonly string[];
};

type ResourceStateByConnection = Map<string, Map<string, IntegrationConnectionResourceState>>;

type AccessibleHandlesByConnection = Map<string, Map<string, Set<string>>>;

function buildResourceStateByConnection(
  resourceStates: readonly IntegrationConnectionResourceState[],
): ResourceStateByConnection {
  const resourceStateByConnection: ResourceStateByConnection = new Map();

  for (const resourceState of resourceStates) {
    let resourceStateByKind = resourceStateByConnection.get(resourceState.connectionId);
    if (resourceStateByKind === undefined) {
      resourceStateByKind = new Map();
      resourceStateByConnection.set(resourceState.connectionId, resourceStateByKind);
    }

    resourceStateByKind.set(resourceState.kind, resourceState);
  }

  return resourceStateByConnection;
}

function buildAccessibleHandlesByConnection(
  accessibleResources: readonly IntegrationConnectionResource[],
): AccessibleHandlesByConnection {
  const accessibleHandlesByConnection: AccessibleHandlesByConnection = new Map();

  for (const resource of accessibleResources) {
    let accessibleHandlesByKind = accessibleHandlesByConnection.get(resource.connectionId);
    if (accessibleHandlesByKind === undefined) {
      accessibleHandlesByKind = new Map();
      accessibleHandlesByConnection.set(resource.connectionId, accessibleHandlesByKind);
    }

    let accessibleHandles = accessibleHandlesByKind.get(resource.kind);
    if (accessibleHandles === undefined) {
      accessibleHandles = new Set();
      accessibleHandlesByKind.set(resource.kind, accessibleHandles);
    }

    accessibleHandles.add(resource.handle);
  }

  return accessibleHandlesByConnection;
}

function readSelectedHandles(input: {
  selectionMode: "single" | "multi";
  field: string;
  bindingConfig: Record<string, unknown>;
}): readonly string[] {
  const rawValue = input.bindingConfig[input.field];

  if (rawValue === undefined) {
    return [];
  }

  if (input.selectionMode === IntegrationResourceSelectionModes.SINGLE) {
    if (typeof rawValue !== "string") {
      throw new Error(
        `Expected binding field '${input.field}' to be a string for single resource selection.`,
      );
    }

    return rawValue.length === 0 ? [] : [rawValue];
  }

  if (!Array.isArray(rawValue)) {
    throw new Error(
      `Expected binding field '${input.field}' to be a string array for multi resource selection.`,
    );
  }

  if (!rawValue.every((value) => typeof value === "string")) {
    throw new Error(
      `Expected binding field '${input.field}' to contain only strings for multi resource selection.`,
    );
  }

  return rawValue;
}

function collectPendingSelections(
  input: readonly BindingSelectionValidationInput[],
): readonly PendingSelectionValidation[] {
  const pendingSelections: PendingSelectionValidation[] = [];

  for (const binding of input) {
    for (const resourceDefinition of binding.definition.resourceDefinitions ?? []) {
      const selectedHandles = readSelectedHandles({
        selectionMode: resourceDefinition.selectionMode,
        field: resourceDefinition.bindingField,
        bindingConfig: binding.bindingConfig,
      });

      if (selectedHandles.length === 0) {
        continue;
      }

      pendingSelections.push({
        bindingIdOrDraftIndex: binding.bindingIdOrDraftIndex,
        ...(binding.clientRef === undefined ? {} : { clientRef: binding.clientRef }),
        connectionId: binding.connectionId,
        kind: resourceDefinition.kind,
        field: resourceDefinition.bindingField,
        displayNameSingular: resourceDefinition.displayNameSingular,
        displayNamePlural: resourceDefinition.displayNamePlural,
        selectedHandles: [...new Set(selectedHandles)],
      });
    }
  }

  return pendingSelections;
}

export async function validateBindingResources(input: {
  db: CreateSandboxProfilesServiceInput["db"];
  bindings: readonly BindingSelectionValidationInput[];
}): Promise<
  | {
      ok: true;
    }
  | {
      ok: false;
      issues: readonly BindingResourceValidationIssue[];
    }
> {
  const pendingSelections = collectPendingSelections(input.bindings);

  if (pendingSelections.length === 0) {
    return {
      ok: true,
    };
  }

  const connectionIds = [...new Set(pendingSelections.map((selection) => selection.connectionId))];
  const kinds = [...new Set(pendingSelections.map((selection) => selection.kind))];
  const handles = [
    ...new Set(
      pendingSelections.flatMap((selection) => selection.selectedHandles.map((handle) => handle)),
    ),
  ];

  const resourceStates = await input.db.query.integrationConnectionResourceStates.findMany({
    where: (table, { and, inArray }) =>
      and(inArray(table.connectionId, connectionIds), inArray(table.kind, kinds)),
  });
  const resourceStateByConnection = buildResourceStateByConnection(resourceStates);

  const accessibleResources =
    handles.length === 0
      ? []
      : await input.db.query.integrationConnectionResources.findMany({
          where: (table, { and, eq, inArray }) =>
            and(
              inArray(table.connectionId, connectionIds),
              inArray(table.kind, kinds),
              inArray(table.handle, handles),
              eq(table.status, IntegrationConnectionResourceStatuses.ACCESSIBLE),
            ),
        });
  const accessibleHandlesByConnection = buildAccessibleHandlesByConnection(accessibleResources);

  const issues: BindingResourceValidationIssue[] = [];

  for (const selection of pendingSelections) {
    const resourceState = resourceStateByConnection
      .get(selection.connectionId)
      ?.get(selection.kind);

    if (
      resourceState === undefined ||
      resourceState.syncState === IntegrationConnectionResourceSyncStates.NEVER_SYNCED
    ) {
      issues.push({
        bindingIdOrDraftIndex: selection.bindingIdOrDraftIndex,
        ...(selection.clientRef === undefined ? {} : { clientRef: selection.clientRef }),
        validatorCode: "system.resource_sync_required",
        field: selection.field,
        safeMessage: `Resource sync is required before ${selection.displayNamePlural} can be selected for this connection.`,
      });
      continue;
    }

    if (
      resourceState.syncState === IntegrationConnectionResourceSyncStates.SYNCING &&
      resourceState.lastSyncedAt === null
    ) {
      issues.push({
        bindingIdOrDraftIndex: selection.bindingIdOrDraftIndex,
        ...(selection.clientRef === undefined ? {} : { clientRef: selection.clientRef }),
        validatorCode: "system.resource_sync_in_progress",
        field: selection.field,
        safeMessage: `Resource sync is still in progress for ${selection.displayNamePlural}.`,
      });
      continue;
    }

    if (
      resourceState.syncState === IntegrationConnectionResourceSyncStates.ERROR &&
      resourceState.lastSyncedAt === null
    ) {
      issues.push({
        bindingIdOrDraftIndex: selection.bindingIdOrDraftIndex,
        ...(selection.clientRef === undefined ? {} : { clientRef: selection.clientRef }),
        validatorCode: "system.resource_sync_failed",
        field: selection.field,
        safeMessage: `Resource sync failed before any ${selection.displayNamePlural} were available for selection.`,
      });
      continue;
    }

    for (const handle of selection.selectedHandles) {
      if (
        accessibleHandlesByConnection
          .get(selection.connectionId)
          ?.get(selection.kind)
          ?.has(handle) === true
      ) {
        continue;
      }

      issues.push({
        bindingIdOrDraftIndex: selection.bindingIdOrDraftIndex,
        ...(selection.clientRef === undefined ? {} : { clientRef: selection.clientRef }),
        validatorCode: "system.inaccessible_resource_reference",
        field: selection.field,
        safeMessage: `Selected ${selection.displayNameSingular} '${handle}' is no longer accessible for this connection.`,
      });
    }
  }

  if (issues.length === 0) {
    return {
      ok: true,
    };
  }

  return {
    ok: false,
    issues,
  };
}

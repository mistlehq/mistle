import {
  IntegrationConnectionResourceSyncStates,
  type IntegrationConnectionResourceState,
} from "@mistle/db/control-plane";
import type {
  AnyIntegrationDefinition,
  IntegrationResourceDefinition,
} from "@mistle/integrations-core";

export type ConnectionResourceSummary = {
  kind: string;
  selectionMode: IntegrationResourceDefinition["selectionMode"];
  count: number;
  syncState: IntegrationConnectionResourceState["syncState"];
  lastSyncedAt?: string;
};

export function projectConnectionResourceSummaries(input: {
  definition: AnyIntegrationDefinition | undefined;
  resourceStates: ReadonlyArray<IntegrationConnectionResourceState>;
}): Array<ConnectionResourceSummary> {
  const resourceDefinitions = input.definition?.resourceDefinitions ?? [];
  if (resourceDefinitions.length === 0) {
    return [];
  }

  const statesByKind = new Map<string, IntegrationConnectionResourceState>();

  for (const state of input.resourceStates) {
    statesByKind.set(state.kind, state);
  }

  return resourceDefinitions.map((resourceDefinition) => {
    const state = statesByKind.get(resourceDefinition.kind);

    return {
      kind: resourceDefinition.kind,
      selectionMode: resourceDefinition.selectionMode,
      count: state?.totalCount ?? 0,
      syncState: state?.syncState ?? IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
      ...(state?.lastSyncedAt === null || state?.lastSyncedAt === undefined
        ? {}
        : { lastSyncedAt: normalizeTimestamp(state.lastSyncedAt) }),
    };
  });
}

function normalizeTimestamp(value: string | Date): string {
  return new Date(value).toISOString();
}

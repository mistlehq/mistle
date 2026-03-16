import {
  integrationConnectionResources,
  integrationConnectionResourceStates,
  IntegrationConnectionResourceStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import type { DiscoveredIntegrationResource } from "@mistle/integrations-core";
import { eq, inArray, sql } from "drizzle-orm";

export async function applySuccessfulResourceSync(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  familyId: string;
  kind: string;
  discoveredResources: ReadonlyArray<DiscoveredIntegrationResource>;
}): Promise<void> {
  await input.db.transaction(async (tx) => {
    const existingResources = await tx.query.integrationConnectionResources.findMany({
      where: (table, { and, eq: whereEq }) =>
        and(whereEq(table.connectionId, input.connectionId), whereEq(table.kind, input.kind)),
    });

    const existingByHandle = new Map<string, (typeof existingResources)[number]>();
    const existingByExternalId = new Map<string, (typeof existingResources)[number]>();

    for (const existingResource of existingResources) {
      existingByHandle.set(existingResource.handle, existingResource);
      if (existingResource.externalId !== null) {
        existingByExternalId.set(existingResource.externalId, existingResource);
      }
    }

    const matchedExistingIds = new Set<string>();
    for (const discoveredResource of input.discoveredResources) {
      const matchedByExternalId =
        discoveredResource.externalId === undefined
          ? undefined
          : existingByExternalId.get(discoveredResource.externalId);
      const matchedByHandle = existingByHandle.get(discoveredResource.handle);
      const matchedResource =
        matchedByExternalId === undefined ? matchedByHandle : matchedByExternalId;

      if (
        matchedByExternalId !== undefined &&
        matchedByHandle !== undefined &&
        matchedByExternalId.id !== matchedByHandle.id
      ) {
        throw new Error(
          `Provider snapshot matched multiple persisted resources for '${discoveredResource.handle}'.`,
        );
      }

      if (matchedResource === undefined) {
        await tx.insert(integrationConnectionResources).values({
          connectionId: input.connectionId,
          familyId: input.familyId,
          kind: input.kind,
          ...(discoveredResource.externalId === undefined
            ? {}
            : { externalId: discoveredResource.externalId }),
          handle: discoveredResource.handle,
          displayName: discoveredResource.displayName,
          status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
          unavailableReason: null,
          metadata: discoveredResource.metadata,
          lastSeenAt: sql`now()`,
          removedAt: null,
          updatedAt: sql`now()`,
        });
        continue;
      }

      if (matchedExistingIds.has(matchedResource.id)) {
        throw new Error(
          `Provider snapshot matched persisted resource '${matchedResource.id}' more than once.`,
        );
      }
      matchedExistingIds.add(matchedResource.id);

      await tx
        .update(integrationConnectionResources)
        .set({
          familyId: input.familyId,
          ...(discoveredResource.externalId === undefined
            ? { externalId: null }
            : { externalId: discoveredResource.externalId }),
          handle: discoveredResource.handle,
          displayName: discoveredResource.displayName,
          status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
          unavailableReason: null,
          metadata: discoveredResource.metadata,
          lastSeenAt: sql`now()`,
          removedAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(integrationConnectionResources.id, matchedResource.id));
    }

    const accessibleIdsToMarkUnavailable = existingResources
      .filter(
        (existingResource) =>
          existingResource.status === IntegrationConnectionResourceStatuses.ACCESSIBLE &&
          !matchedExistingIds.has(existingResource.id),
      )
      .map((existingResource) => existingResource.id);

    if (accessibleIdsToMarkUnavailable.length > 0) {
      await tx
        .update(integrationConnectionResources)
        .set({
          status: IntegrationConnectionResourceStatuses.UNAVAILABLE,
          unavailableReason: null,
          removedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(inArray(integrationConnectionResources.id, accessibleIdsToMarkUnavailable));
    }

    await tx
      .insert(integrationConnectionResourceStates)
      .values({
        connectionId: input.connectionId,
        familyId: input.familyId,
        kind: input.kind,
        syncState: "ready",
        totalCount: input.discoveredResources.length,
        lastSyncedAt: sql`now()`,
        lastSyncFinishedAt: sql`now()`,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnectionResourceStates.connectionId,
          integrationConnectionResourceStates.kind,
        ],
        set: {
          familyId: input.familyId,
          syncState: "ready",
          totalCount: input.discoveredResources.length,
          lastSyncedAt: sql`now()`,
          lastSyncFinishedAt: sql`now()`,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: sql`now()`,
        },
      });
  });
}

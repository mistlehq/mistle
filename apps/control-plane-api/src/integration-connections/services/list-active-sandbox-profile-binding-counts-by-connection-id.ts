import {
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { and, eq, inArray, sql } from "drizzle-orm";

export async function listActiveSandboxProfileBindingCountsByConnectionId(input: {
  db: ControlPlaneDatabase;
  connectionIds: readonly string[];
  organizationId: string;
}): Promise<Map<string, number>> {
  if (input.connectionIds.length === 0) {
    return new Map();
  }

  const bindingCounts = await input.db
    .select({
      connectionId: sandboxProfileVersionIntegrationBindings.connectionId,
      bindingCount: sql<number>`count(*)::int`,
    })
    .from(sandboxProfileVersionIntegrationBindings)
    .innerJoin(
      sandboxProfiles,
      eq(sandboxProfiles.id, sandboxProfileVersionIntegrationBindings.sandboxProfileId),
    )
    .where(
      and(
        eq(sandboxProfiles.organizationId, input.organizationId),
        inArray(sandboxProfileVersionIntegrationBindings.connectionId, [...input.connectionIds]),
        eq(
          sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
          sandboxProfiles.activeVersion,
        ),
      ),
    )
    .groupBy(sandboxProfileVersionIntegrationBindings.connectionId);

  return new Map<string, number>(
    bindingCounts.map((entry) => [entry.connectionId, entry.bindingCount]),
  );
}

import { type ControlPlaneDatabase, getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { and, eq, inArray, sql } from "drizzle-orm";

export async function listActiveSandboxProfileBindingCountsByConnectionId(input: {
  db: ControlPlaneDatabase;
  connectionIds: readonly string[];
  organizationId: string;
}): Promise<Map<string, number>> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  if (input.connectionIds.length === 0) {
    return new Map();
  }

  const bindingCounts = await input.db
    .select({
      connectionId: tables.sandboxProfileVersionIntegrationBindings.connectionId,
      bindingCount: sql<number>`count(*)::int`,
    })
    .from(tables.sandboxProfileVersionIntegrationBindings)
    .innerJoin(
      tables.sandboxProfiles,
      eq(
        tables.sandboxProfiles.id,
        tables.sandboxProfileVersionIntegrationBindings.sandboxProfileId,
      ),
    )
    .where(
      and(
        eq(tables.sandboxProfiles.organizationId, input.organizationId),
        inArray(tables.sandboxProfileVersionIntegrationBindings.connectionId, [
          ...input.connectionIds,
        ]),
        eq(
          tables.sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
          tables.sandboxProfiles.activeVersion,
        ),
      ),
    )
    .groupBy(tables.sandboxProfileVersionIntegrationBindings.connectionId);

  return new Map<string, number>(
    bindingCounts.map((entry) => [entry.connectionId, entry.bindingCount]),
  );
}

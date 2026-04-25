import {
  automations,
  automationTargets,
  sandboxProfiles,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { and, eq, inArray } from "drizzle-orm";

export async function deleteSandboxProfile(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: { organizationId: string; profileId: string },
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const automationRows = await tx
      .select({
        automationId: automationTargets.automationId,
      })
      .from(automationTargets)
      .innerJoin(automations, eq(automations.id, automationTargets.automationId))
      .where(
        and(
          eq(automationTargets.sandboxProfileId, input.profileId),
          eq(automations.organizationId, input.organizationId),
        ),
      );

    const automationIds = automationRows.map((row) => row.automationId);
    if (automationIds.length > 0) {
      await tx
        .delete(automations)
        .where(
          and(
            eq(automations.organizationId, input.organizationId),
            inArray(automations.id, automationIds),
          ),
        );
    }

    await tx
      .delete(sandboxProfiles)
      .where(
        and(
          eq(sandboxProfiles.id, input.profileId),
          eq(sandboxProfiles.organizationId, input.organizationId),
        ),
      );
  });
}

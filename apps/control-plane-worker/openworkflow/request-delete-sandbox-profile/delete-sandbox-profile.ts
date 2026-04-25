import { sandboxProfiles, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

export async function deleteSandboxProfile(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: { organizationId: string; profileId: string },
): Promise<void> {
  await ctx.db
    .delete(sandboxProfiles)
    .where(
      and(
        eq(sandboxProfiles.id, input.profileId),
        eq(sandboxProfiles.organizationId, input.organizationId),
      ),
    );
}

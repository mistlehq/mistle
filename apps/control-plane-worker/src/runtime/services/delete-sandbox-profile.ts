import { sandboxProfiles, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

export async function deleteSandboxProfile(
  deps: {
    db: ControlPlaneDatabase;
  },
  input: { organizationId: string; profileId: string },
): Promise<void> {
  await deps.db
    .delete(sandboxProfiles)
    .where(
      and(
        eq(sandboxProfiles.id, input.profileId),
        eq(sandboxProfiles.organizationId, input.organizationId),
      ),
    );
}

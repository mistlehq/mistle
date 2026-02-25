import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import { ControlPlaneDbSchema, MemberRoles } from "@mistle/db/control-plane";
import { typeid } from "typeid-js";

type BootstrapUserOrganizationInput = {
  db: ControlPlaneDatabase;
  userId: string;
  name: string;
};

/**
 * Bootstraps the initial organization, owner membership, default team, and team membership for a new user.
 * The bootstrap organization uses its own ID as slug for uniqueness and stability.
 */
export async function bootstrapUserOrganization(
  input: BootstrapUserOrganizationInput,
): Promise<void> {
  const { db, userId, name } = input;
  const organizationId = typeid("org").toString();

  await db.transaction(async (tx) => {
    await tx.insert(ControlPlaneDbSchema.organizations).values({
      id: organizationId,
      name,
      slug: organizationId,
    });

    await tx.insert(ControlPlaneDbSchema.members).values({
      organizationId,
      userId,
      role: MemberRoles.OWNER,
    });

    const createdTeams = await tx
      .insert(ControlPlaneDbSchema.teams)
      .values({
        organizationId,
        name,
      })
      .returning({
        id: ControlPlaneDbSchema.teams.id,
      });
    const [team] = createdTeams;

    if (team === undefined) {
      throw new Error("Failed to create default team.");
    }

    await tx.insert(ControlPlaneDbSchema.teamMembers).values({
      teamId: team.id,
      userId,
    });
  });
}

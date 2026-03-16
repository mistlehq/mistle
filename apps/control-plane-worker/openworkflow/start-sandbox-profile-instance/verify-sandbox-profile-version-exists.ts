import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

export async function verifySandboxProfileVersionExists(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
}): Promise<void> {
  const sandboxProfile = await input.db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.sandboxProfileId), eq(table.organizationId, input.organizationId)),
  });

  if (sandboxProfile === undefined) {
    throw new Error("Sandbox profile was not found.");
  }

  const sandboxProfileVersion = await input.db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProfileId: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.sandboxProfileId),
        eq(table.version, input.sandboxProfileVersion),
      ),
  });

  if (sandboxProfileVersion === undefined) {
    throw new Error("Sandbox profile version was not found.");
  }
}

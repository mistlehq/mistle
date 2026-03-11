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
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.sandboxProfileId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (sandboxProfile === undefined) {
    throw new Error("Sandbox profile was not found.");
  }

  const sandboxProfileVersion = await input.db.query.sandboxProfileVersions.findFirst({
    columns: {
      sandboxProfileId: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.sandboxProfileId, input.sandboxProfileId),
        whereEq(table.version, input.sandboxProfileVersion),
      ),
  });

  if (sandboxProfileVersion === undefined) {
    throw new Error("Sandbox profile version was not found.");
  }
}

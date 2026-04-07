import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";

export async function getUserAvatar(input: {
  db: ControlPlaneDatabase;
  userId: string;
}): Promise<{ imageObjectKey: string | null }> {
  const user = await input.db.query.users.findFirst({
    columns: {
      imageObjectKey: true,
    },
    where: (table, { eq }) => eq(table.id, input.userId),
  });

  if (user === undefined) {
    throw new NotFoundError("NOT_FOUND", "User was not found.");
  }

  return {
    imageObjectKey:
      user.imageObjectKey !== null && user.imageObjectKey.length > 0 ? user.imageObjectKey : null,
  };
}

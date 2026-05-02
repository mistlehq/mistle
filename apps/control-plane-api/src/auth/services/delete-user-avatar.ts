import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import type { S3CompatibleObjectStore } from "@mistle/object-store";
import { eq } from "drizzle-orm";

import { deleteObjectBestEffort } from "./delete-object-best-effort.js";

export type DeleteUserAvatarContext = {
  db: ControlPlaneDatabase;
  objectStore: S3CompatibleObjectStore;
};

export type DeleteUserAvatarInput = {
  userId: string;
};

export async function deleteUserAvatar(
  ctx: DeleteUserAvatarContext,
  input: DeleteUserAvatarInput,
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const existingUser = await ctx.db.query.users.findFirst({
    columns: {
      id: true,
      imageObjectKey: true,
    },
    where: (table, { eq: equals }) => equals(table.id, input.userId),
  });

  if (existingUser === undefined) {
    throw new NotFoundError("NOT_FOUND", "User was not found.");
  }

  if (existingUser.imageObjectKey === null || existingUser.imageObjectKey.length === 0) {
    return;
  }

  const updatedUsers = await ctx.db
    .update(tables.users)
    .set({
      imageObjectKey: null,
    })
    .where(eq(tables.users.id, input.userId))
    .returning({
      id: tables.users.id,
    });
  const [updatedUser] = updatedUsers;

  if (updatedUser === undefined) {
    throw new Error("Failed to remove the uploaded user avatar.");
  }

  await deleteObjectBestEffort({
    objectStore: ctx.objectStore,
    objectKey: existingUser.imageObjectKey,
    subject: "user_avatar",
  });
}

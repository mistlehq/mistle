import { users, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import { S3CompatibleObjectStore } from "@mistle/object-store";
import { eq, sql } from "drizzle-orm";

import { deleteObjectIgnoringErrors } from "../../media/services/delete-object-ignoring-errors.js";
import { normalizeUploadedImage } from "../../media/services/normalize-uploaded-image.js";
import { createUserAvatarObjectKey } from "../../media/services/object-key.js";

export type UploadUserAvatarInput = {
  actorUserId: string;
  body: Uint8Array;
  contentType: string;
};

export async function uploadUserAvatar(
  ctx: {
    db: ControlPlaneDatabase;
    objectStore: S3CompatibleObjectStore;
  },
  input: UploadUserAvatarInput,
): Promise<string> {
  const existingUser = await ctx.db.query.users.findFirst({
    columns: {
      id: true,
      imageObjectKey: true,
    },
    where: (table, { eq: equals }) => equals(table.id, input.actorUserId),
  });

  if (existingUser === undefined) {
    throw new NotFoundError("NOT_FOUND", "User was not found.");
  }

  const normalizedImage = await normalizeUploadedImage({
    body: input.body,
    contentType: input.contentType,
  });
  const imageObjectKey = createUserAvatarObjectKey(existingUser.id);

  await ctx.objectStore.putObject({
    objectKey: imageObjectKey,
    Body: normalizedImage.body,
    ContentType: normalizedImage.contentType,
  });

  try {
    await ctx.db
      .update(users)
      .set({
        imageObjectKey,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, existingUser.id));
  } catch (error) {
    await deleteObjectIgnoringErrors(ctx.objectStore, imageObjectKey);
    throw error;
  }

  if (existingUser.imageObjectKey !== null) {
    await deleteObjectIgnoringErrors(ctx.objectStore, existingUser.imageObjectKey);
  }

  return imageObjectKey;
}

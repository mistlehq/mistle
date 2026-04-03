import { users, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import { S3CompatibleObjectStore } from "@mistle/object-store";
import { and, eq, sql } from "drizzle-orm";

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
  const normalizedImage = await normalizeUploadedImage({
    body: input.body,
    contentType: input.contentType,
  });
  const imageObjectKey = createUserAvatarObjectKey(input.actorUserId);

  await ctx.objectStore.putObject({
    objectKey: imageObjectKey,
    Body: normalizedImage.body,
    ContentType: normalizedImage.contentType,
  });

  let previousImageObjectKeyToDelete: string | null = null;
  let stored = false;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existingUser = await ctx.db.query.users.findFirst({
      columns: {
        id: true,
        imageObjectKey: true,
      },
      where: (table, { eq: equals }) => equals(table.id, input.actorUserId),
    });

    if (existingUser === undefined) {
      await deleteObjectIgnoringErrors(ctx.objectStore, imageObjectKey);
      throw new NotFoundError("NOT_FOUND", "User was not found.");
    }

    const updatedUsers = await ctx.db
      .update(users)
      .set({
        imageObjectKey,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(users.id, existingUser.id),
          sql`${users.imageObjectKey} IS NOT DISTINCT FROM ${existingUser.imageObjectKey}`,
        ),
      )
      .returning({
        id: users.id,
      });

    if (updatedUsers.length === 1) {
      previousImageObjectKeyToDelete = existingUser.imageObjectKey;
      stored = true;
      break;
    }
  }

  if (!stored) {
    await deleteObjectIgnoringErrors(ctx.objectStore, imageObjectKey);
    throw new Error("Failed to persist uploaded user avatar after concurrent updates.");
  }

  if (
    previousImageObjectKeyToDelete !== null &&
    previousImageObjectKeyToDelete !== imageObjectKey
  ) {
    await deleteObjectIgnoringErrors(ctx.objectStore, previousImageObjectKeyToDelete);
  }

  return imageObjectKey;
}

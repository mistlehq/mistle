import { users } from "@mistle/db/control-plane";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import type { S3CompatibleObjectStore } from "@mistle/object-store";
import { eq } from "drizzle-orm";
import { typeid } from "typeid-js";

import { normalizeUserAvatarImage } from "./user-avatar-image.js";

export type PutUserAvatarContext = {
  db: ControlPlaneDatabase;
  objectStore: S3CompatibleObjectStore;
};

export type PutUserAvatarInput = {
  userId: string;
  imageBytes: Uint8Array;
};

export type PutUserAvatarResult = {
  userId: string;
  imageObjectKey: string;
};

export async function putUserAvatar(
  ctx: PutUserAvatarContext,
  input: PutUserAvatarInput,
): Promise<PutUserAvatarResult> {
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

  const normalizedAvatar = await normalizeUserAvatarImage({
    imageBytes: input.imageBytes,
  });
  const imageObjectKey = createUserAvatarObjectKey(input.userId);

  await ctx.objectStore.putObject({
    Body: normalizedAvatar.imageBytes,
    ContentType: normalizedAvatar.contentType,
    objectKey: imageObjectKey,
  });

  let updatedUser:
    | {
        id: string;
        imageObjectKey: string | null;
      }
    | undefined;

  try {
    const updatedUsers = await ctx.db
      .update(users)
      .set({
        imageObjectKey,
      })
      .where(eq(users.id, input.userId))
      .returning({
        id: users.id,
        imageObjectKey: users.imageObjectKey,
      });
    [updatedUser] = updatedUsers;
  } catch (error) {
    await deleteObjectIgnoringFailure({
      objectStore: ctx.objectStore,
      objectKey: imageObjectKey,
    });
    throw error;
  }

  if (updatedUser === undefined || updatedUser.imageObjectKey === null) {
    throw new Error("Failed to persist the uploaded user avatar.");
  }

  if (
    existingUser.imageObjectKey !== null &&
    existingUser.imageObjectKey.length > 0 &&
    existingUser.imageObjectKey !== updatedUser.imageObjectKey
  ) {
    await deleteObjectIgnoringFailure({
      objectStore: ctx.objectStore,
      objectKey: existingUser.imageObjectKey,
    });
  }

  return {
    userId: updatedUser.id,
    imageObjectKey: updatedUser.imageObjectKey,
  };
}

function createUserAvatarObjectKey(userId: string): string {
  return `avatars/users/${userId}/${typeid("img").toString()}.webp`;
}

async function deleteObjectIgnoringFailure(input: {
  objectStore: S3CompatibleObjectStore;
  objectKey: string;
}): Promise<void> {
  try {
    // Replacement uploads are already durable; cleanup failure must not roll them back.
    await input.objectStore.deleteObject(input.objectKey);
  } catch (error) {
    void error;
  }
}

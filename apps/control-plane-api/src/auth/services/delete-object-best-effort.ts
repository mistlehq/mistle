import type { S3CompatibleObjectStore } from "@mistle/object-store";

import { logger } from "../../logger.js";

export type DeleteObjectBestEffortInput = {
  objectStore: S3CompatibleObjectStore;
  objectKey: string;
  subject: "organization_logo" | "user_avatar";
};

export async function deleteObjectBestEffort(input: DeleteObjectBestEffortInput): Promise<void> {
  try {
    // Object deletion is cleanup; failure should be observable but must not roll back DB state.
    await input.objectStore.deleteObject(input.objectKey);
  } catch (error) {
    logger.warn(
      {
        err: error,
        objectKey: input.objectKey,
        subject: input.subject,
      },
      "Failed to delete profile image object",
    );
  }
}

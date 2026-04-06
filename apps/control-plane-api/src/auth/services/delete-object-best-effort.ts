import type { S3CompatibleObjectStore } from "@mistle/object-store";

import { logger } from "../../logger.js";

export type DeleteObjectBestEffortInput = {
  objectStore: S3CompatibleObjectStore;
  objectKey: string;
  subject: "organization_logo" | "user_avatar";
};

export async function deleteObjectBestEffort(input: DeleteObjectBestEffortInput): Promise<void> {
  try {
    // Replacement uploads are already durable; cleanup failure must not roll them back.
    await input.objectStore.deleteObject(input.objectKey);
  } catch (error) {
    logger.warn(
      {
        err: error,
        objectKey: input.objectKey,
        subject: input.subject,
      },
      "Failed to delete superseded profile image object",
    );
  }
}

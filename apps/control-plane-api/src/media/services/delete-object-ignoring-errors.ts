import { S3CompatibleObjectStore } from "@mistle/object-store";

export async function deleteObjectIgnoringErrors(
  objectStore: S3CompatibleObjectStore,
  objectKey: string,
): Promise<void> {
  try {
    await objectStore.deleteObject(objectKey);
  } catch {}
}

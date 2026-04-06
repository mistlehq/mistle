import { S3CompatibleObjectStore } from "@mistle/object-store";
import { startSeaweedfsS3 } from "@mistle/test-harness";

export function createTestObjectStore(
  seaweedfs: Awaited<ReturnType<typeof startSeaweedfsS3>>,
): S3CompatibleObjectStore {
  return new S3CompatibleObjectStore({
    bucketName: seaweedfs.bucketName,
    credentials: {
      accessKeyId: seaweedfs.accessKeyId,
      secretAccessKey: seaweedfs.secretAccessKey,
    },
    endpoint: seaweedfs.endpoint,
    forcePathStyle: true,
    region: seaweedfs.region,
  });
}

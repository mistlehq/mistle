import { S3CompatibleObjectStore } from "@mistle/object-store";
import { startSeaweedfsS3 } from "@mistle/test-harness";
import sharp from "sharp";

let storedWebpFixtureBytes: Uint8Array | undefined;

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

export async function getStoredWebpFixtureBytes(): Promise<Uint8Array> {
  if (storedWebpFixtureBytes !== undefined) {
    return storedWebpFixtureBytes;
  }

  const bytes = await sharp({
    create: {
      width: 128,
      height: 128,
      channels: 4,
      background: {
        r: 80,
        g: 140,
        b: 220,
        alpha: 1,
      },
    },
  })
    .webp()
    .toBuffer();

  storedWebpFixtureBytes = new Uint8Array(bytes);
  return storedWebpFixtureBytes;
}

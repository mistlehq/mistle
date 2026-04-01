import { startSeaweedfsS3 } from "@mistle/test-harness";
import { describe, expect, test } from "vitest";

import { ObjectStoreObjectNotFoundError } from "../src/object-store-error.js";
import { createS3CompatibleObjectStore } from "../src/s3-compatible-object-store.js";

describe("S3-compatible object store integration", () => {
  test("writes, reads, heads, and deletes objects against SeaweedFS", async () => {
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "object-store-integration",
    });

    const objectStore = createS3CompatibleObjectStore({
      bucketName: seaweedfs.bucketName,
      credentials: {
        accessKeyId: seaweedfs.accessKeyId,
        secretAccessKey: seaweedfs.secretAccessKey,
      },
      endpoint: seaweedfs.endpoint,
      forcePathStyle: true,
      region: seaweedfs.region,
    });

    const objectKey = "avatars/users/usr_test/avatar.webp";
    const objectBytes = new TextEncoder().encode("hello-seaweedfs");

    try {
      await objectStore.putObject({
        body: objectBytes,
        cacheControl: "public, max-age=60",
        contentType: "image/webp",
        objectKey,
      });

      await expect(
        objectStore.headObject({
          objectKey,
        }),
      ).resolves.toEqual({
        contentLength: objectBytes.byteLength,
        contentType: "image/webp",
      });

      await expect(
        objectStore.readObject({
          objectKey,
        }),
      ).resolves.toEqual({
        bytes: objectBytes,
        contentType: "image/webp",
      });

      await objectStore.deleteObject({
        objectKey,
      });

      await expect(
        objectStore.headObject({
          objectKey,
        }),
      ).rejects.toBeInstanceOf(ObjectStoreObjectNotFoundError);
    } finally {
      await seaweedfs.stop();
    }
  }, 60_000);
});

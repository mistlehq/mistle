import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { startSeaweedfsS3 } from "@mistle/test-harness";
import { describe, expect, test } from "vitest";

import { S3CompatibleObjectStore } from "../src/s3-compatible-object-store.js";

describe("S3-compatible object store integration", () => {
  test("starts SeaweedFS through the harness and performs object-store operations end to end", async () => {
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "object-store-integration",
    });

    const s3ClientConfig = {
      credentials: {
        accessKeyId: seaweedfs.accessKeyId,
        secretAccessKey: seaweedfs.secretAccessKey,
      },
      endpoint: seaweedfs.endpoint,
      forcePathStyle: true,
      region: seaweedfs.region,
    } as const;

    const s3Client = new S3Client(s3ClientConfig);

    const objectStore = new S3CompatibleObjectStore({
      bucketName: seaweedfs.bucketName,
      ...s3ClientConfig,
    });

    const objectKey = "avatars/users/usr_test/avatar.webp";
    const objectBytes = new TextEncoder().encode("hello-seaweedfs");

    await expect(
      s3Client.send(
        new HeadBucketCommand({
          Bucket: seaweedfs.bucketName,
        }),
      ),
    ).resolves.toMatchObject({
      $metadata: {
        httpStatusCode: 200,
      },
    });

    await objectStore.putObject({
      Body: objectBytes,
      CacheControl: "public, max-age=60",
      ContentType: "image/webp",
      objectKey,
    });

    const headObjectResponse = await objectStore.headObject(objectKey);

    expect(headObjectResponse.ContentLength).toBe(objectBytes.byteLength);
    expect(headObjectResponse.ContentType).toBe("image/webp");

    const readObjectResponse = await objectStore.readObject(objectKey);

    expect(readObjectResponse.ContentType).toBe("image/webp");
    expect(typeof readObjectResponse.Body?.transformToByteArray).toBe("function");
    if (
      readObjectResponse.Body === undefined ||
      typeof readObjectResponse.Body.transformToByteArray !== "function"
    ) {
      throw new Error("Expected GetObject response body to support transformToByteArray().");
    }

    await expect(readObjectResponse.Body.transformToByteArray()).resolves.toEqual(objectBytes);

    await objectStore.deleteObject(objectKey);

    await expect(objectStore.headObject(objectKey)).rejects.toMatchObject({
      name: "NotFound",
    });

    objectStore.destroy();
    await seaweedfs.stop();

    await expect(seaweedfs.stop()).rejects.toThrow("SeaweedFS container was already stopped.");
  }, 60_000);

  test("uses path-style requests by default for custom S3-compatible endpoints", async () => {
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "object-store-default-path-style",
    });

    const objectStore = new S3CompatibleObjectStore({
      bucketName: seaweedfs.bucketName,
      credentials: {
        accessKeyId: seaweedfs.accessKeyId,
        secretAccessKey: seaweedfs.secretAccessKey,
      },
      endpoint: seaweedfs.endpoint,
      region: seaweedfs.region,
    });

    try {
      await expect(
        objectStore.putObject({
          Body: new TextEncoder().encode("path-style-default"),
          ContentType: "text/plain",
          objectKey: "path-style-default.txt",
        }),
      ).resolves.toMatchObject({
        $metadata: {
          httpStatusCode: 200,
        },
      });
    } finally {
      objectStore.destroy();
      await seaweedfs.stop();
    }
  }, 60_000);
});

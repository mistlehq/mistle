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

  test("creates a presigned GET URL that can read object bytes from SeaweedFS", async () => {
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "object-store-presigned-get",
    });

    const objectStore = new S3CompatibleObjectStore({
      bucketName: seaweedfs.bucketName,
      credentials: {
        accessKeyId: seaweedfs.accessKeyId,
        secretAccessKey: seaweedfs.secretAccessKey,
      },
      endpoint: seaweedfs.endpoint,
      forcePathStyle: true,
      region: seaweedfs.region,
    });

    const objectKey = "avatars/users/usr_test/presigned-avatar.webp";
    const objectBytes = new TextEncoder().encode("presigned-read-bytes");

    try {
      await objectStore.putObject({
        Body: objectBytes,
        ContentType: "image/webp",
        objectKey,
      });

      const presignedGetUrl = await objectStore.createPresignedGetUrl({
        objectKey,
        expiresInSeconds: 60,
      });

      const response = await fetch(presignedGetUrl);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/webp");
      await expect(response.bytes()).resolves.toEqual(objectBytes);
    } finally {
      objectStore.destroy();
      await seaweedfs.stop();
    }
  }, 60_000);

  test("rejects a tampered presigned GET URL", async () => {
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "object-store-presigned-get-invalid",
    });

    const objectStore = new S3CompatibleObjectStore({
      bucketName: seaweedfs.bucketName,
      credentials: {
        accessKeyId: seaweedfs.accessKeyId,
        secretAccessKey: seaweedfs.secretAccessKey,
      },
      endpoint: seaweedfs.endpoint,
      forcePathStyle: true,
      region: seaweedfs.region,
    });

    const objectKey = "avatars/users/usr_test/tampered-avatar.webp";

    try {
      await objectStore.putObject({
        Body: new TextEncoder().encode("tampered-presign"),
        ContentType: "image/webp",
        objectKey,
      });

      const presignedGetUrl = await objectStore.createPresignedGetUrl({
        objectKey,
        expiresInSeconds: 60,
      });
      const tamperedUrl = new URL(presignedGetUrl);
      const signature = tamperedUrl.searchParams.get("X-Amz-Signature");

      if (signature === null || signature.length === 0) {
        throw new Error("Expected presigned GET URL to include X-Amz-Signature.");
      }

      tamperedUrl.searchParams.set(
        "X-Amz-Signature",
        `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`,
      );

      const response = await fetch(tamperedUrl);

      expect(response.ok).toBe(false);
      expect(response.status).toBeGreaterThanOrEqual(400);
    } finally {
      objectStore.destroy();
      await seaweedfs.stop();
    }
  }, 60_000);
});

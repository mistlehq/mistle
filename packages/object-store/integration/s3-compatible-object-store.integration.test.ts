import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { startSeaweedfsS3 } from "@mistle/test-harness";
import { describe, expect, test } from "vitest";

import { S3CompatibleObjectStore } from "../src/s3-compatible-object-store.js";

type ByteArrayReadable = {
  transformToByteArray: () => Promise<Uint8Array>;
};

function hasTransformToByteArray(body: unknown): body is ByteArrayReadable {
  if (typeof body !== "object" || body === null) {
    return false;
  }

  if (!("transformToByteArray" in body)) {
    return false;
  }

  return typeof body.transformToByteArray === "function";
}

describe("S3-compatible object store integration", () => {
  test("starts SeaweedFS through the harness and performs object-store operations end to end", async () => {
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "object-store-integration",
    });

    const s3Client = new S3Client({
      credentials: {
        accessKeyId: seaweedfs.accessKeyId,
        secretAccessKey: seaweedfs.secretAccessKey,
      },
      endpoint: seaweedfs.endpoint,
      forcePathStyle: true,
      region: seaweedfs.region,
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
      body: objectBytes,
      cacheControl: "public, max-age=60",
      contentType: "image/webp",
      objectKey,
    });

    const headObjectResponse = await objectStore.headObject({
      objectKey,
    });

    expect(headObjectResponse.ContentLength).toBe(objectBytes.byteLength);
    expect(headObjectResponse.ContentType).toBe("image/webp");

    const readObjectResponse = await objectStore.readObject({
      objectKey,
    });

    expect(readObjectResponse.ContentType).toBe("image/webp");
    expect(hasTransformToByteArray(readObjectResponse.Body)).toBe(true);
    if (!hasTransformToByteArray(readObjectResponse.Body)) {
      throw new Error("Expected GetObject response body to support transformToByteArray().");
    }

    await expect(readObjectResponse.Body.transformToByteArray()).resolves.toEqual(objectBytes);

    await objectStore.deleteObject({
      objectKey,
    });

    await expect(
      objectStore.headObject({
        objectKey,
      }),
    ).rejects.toMatchObject({
      name: "NotFound",
    });

    await seaweedfs.stop();

    await expect(seaweedfs.stop()).rejects.toThrow("SeaweedFS container was already stopped.");
  }, 60_000);
});

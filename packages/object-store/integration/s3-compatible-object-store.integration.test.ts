import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { startSeaweedfsS3 } from "@mistle/test-harness";
import { describe, expect, test } from "vitest";

import { S3CompatibleObjectStore } from "../src/s3-compatible-object-store.js";

async function withObjectStoreTestContext(
  input: {
    bucketName: string;
  },
  run: (input: {
    objectStore: S3CompatibleObjectStore;
    s3Client: S3Client;
    seaweedfs: Awaited<ReturnType<typeof startSeaweedfsS3>>;
  }) => Promise<void>,
): Promise<void> {
  const seaweedfs = await startSeaweedfsS3({
    bucketName: input.bucketName,
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

  try {
    await run({
      objectStore,
      s3Client,
      seaweedfs,
    });
  } finally {
    objectStore.destroy();
    await seaweedfs.stop();
  }
}

describe("S3-compatible object store integration", () => {
  test("starts SeaweedFS through the harness and performs object-store operations end to end", async () => {
    await withObjectStoreTestContext(
      {
        bucketName: "object-store-integration",
      },
      async ({ objectStore, s3Client, seaweedfs }) => {
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
      },
    );
  }, 60_000);

  test("uses path-style requests by default for custom S3-compatible endpoints", async () => {
    await withObjectStoreTestContext(
      {
        bucketName: "object-store-default-path-style",
      },
      async ({ objectStore }) => {
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
      },
    );
  }, 60_000);

  test("creates presigned put URLs that upload successfully to SeaweedFS", async () => {
    await withObjectStoreTestContext(
      {
        bucketName: "object-store-presigned-put",
      },
      async ({ objectStore }) => {
        const objectKey = "avatars/users/usr_presigned/avatar.webp";
        const objectBytes = new TextEncoder().encode("presigned-upload");

        const presignedPut = await objectStore.createPresignedPutUrl({
          CacheControl: "public, max-age=120",
          ContentType: "image/webp",
          expiresInSeconds: 60,
          objectKey,
        });

        expect(presignedPut.method).toBe("PUT");
        expect(presignedPut.headers).toEqual({
          "cache-control": "public, max-age=120",
          "content-type": "image/webp",
        });

        const uploadResponse = await fetch(presignedPut.url, {
          body: objectBytes,
          headers: presignedPut.headers,
          method: presignedPut.method,
        });

        expect(uploadResponse.status).toBe(200);

        const headObjectResponse = await objectStore.headObject(objectKey);
        expect(headObjectResponse.ContentLength).toBe(objectBytes.byteLength);
        expect(headObjectResponse.ContentType).toBe("image/webp");
        expect(headObjectResponse.CacheControl).toBe("public, max-age=120");

        const readObjectResponse = await objectStore.readObject(objectKey);
        expect(typeof readObjectResponse.Body?.transformToByteArray).toBe("function");
        if (
          readObjectResponse.Body === undefined ||
          typeof readObjectResponse.Body.transformToByteArray !== "function"
        ) {
          throw new Error(
            "Expected presigned upload object body to support transformToByteArray().",
          );
        }

        await expect(readObjectResponse.Body.transformToByteArray()).resolves.toEqual(objectBytes);
      },
    );
  }, 60_000);
});

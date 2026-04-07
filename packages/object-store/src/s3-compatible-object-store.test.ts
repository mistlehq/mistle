import { describe, expect, it } from "vitest";

import { S3CompatibleObjectStore } from "./s3-compatible-object-store.js";

function createObjectStore(): S3CompatibleObjectStore {
  return new S3CompatibleObjectStore({
    bucketName: "test-bucket",
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    endpoint: "http://127.0.0.1:8333",
    region: "us-east-1",
  });
}

describe("S3CompatibleObjectStore.createPresignedGetUrl", () => {
  it("fails fast when expiresInSeconds is not a positive integer", async () => {
    const objectStore = createObjectStore();

    try {
      await expect(
        objectStore.createPresignedGetUrl({
          objectKey: "avatars/users/usr_test/avatar.webp",
          expiresInSeconds: 0,
        }),
      ).rejects.toThrow("expiresInSeconds must be a positive integer.");

      await expect(
        objectStore.createPresignedGetUrl({
          objectKey: "avatars/users/usr_test/avatar.webp",
          expiresInSeconds: 1.5,
        }),
      ).rejects.toThrow("expiresInSeconds must be a positive integer.");
    } finally {
      objectStore.destroy();
    }
  });

  it("fails fast when expiresInSeconds exceeds the S3 maximum", async () => {
    const objectStore = createObjectStore();

    try {
      await expect(
        objectStore.createPresignedGetUrl({
          objectKey: "avatars/users/usr_test/avatar.webp",
          expiresInSeconds: 604_801,
        }),
      ).rejects.toThrow("expiresInSeconds must be less than or equal to 604800.");
    } finally {
      objectStore.destroy();
    }
  });
});

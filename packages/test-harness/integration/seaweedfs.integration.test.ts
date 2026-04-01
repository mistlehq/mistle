import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, test } from "vitest";

import { startSeaweedfsS3 } from "../src/index.js";

describe("SeaweedFS S3 service integration", () => {
  test("starts SeaweedFS and provisions the requested bucket", async () => {
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "seaweedfs-integration",
    });

    const client = new S3Client({
      credentials: {
        accessKeyId: seaweedfs.accessKeyId,
        secretAccessKey: seaweedfs.secretAccessKey,
      },
      endpoint: seaweedfs.endpoint,
      forcePathStyle: true,
      region: seaweedfs.region,
    });

    try {
      const response = await client.send(
        new HeadBucketCommand({
          Bucket: seaweedfs.bucketName,
        }),
      );

      expect(response.$metadata.httpStatusCode).toBe(200);
    } finally {
      await seaweedfs.stop();
    }
  }, 60_000);

  test("throws when stopping the same SeaweedFS service twice", async () => {
    const seaweedfs = await startSeaweedfsS3();
    await seaweedfs.stop();

    await expect(seaweedfs.stop()).rejects.toThrow("SeaweedFS container was already stopped.");
  }, 60_000);
});

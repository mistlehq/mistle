import { describe, expect, test } from "vitest";

import { startDockerNetwork, startSeaweedfsS3 } from "../src/index.js";

describe("SeaweedFS S3 service network integration", () => {
  test("returns a network-reachable endpoint when started on a Docker network", async () => {
    const network = await startDockerNetwork();

    try {
      const seaweedfs = await startSeaweedfsS3({
        bucketName: "seaweedfs-network-integration",
        network,
        networkAlias: "seaweedfs-test",
      });

      try {
        expect(seaweedfs.endpoint).toBe("http://seaweedfs-test:8333");
      } finally {
        await seaweedfs.stop();
      }
    } finally {
      await network.stop();
    }
  }, 60_000);
});

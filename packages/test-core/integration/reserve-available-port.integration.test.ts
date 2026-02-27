import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import { reserveAvailablePort } from "../src/index.js";

describe("reserveAvailablePort integration", () => {
  it("returns an ephemeral port that can be rebound", async () => {
    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });

    await new Promise<void>((resolve, reject) => {
      const server = createServer();

      server.once("error", reject);
      server.listen(port, host, () => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    });

    expect(port).toBeGreaterThan(0);
  });
});

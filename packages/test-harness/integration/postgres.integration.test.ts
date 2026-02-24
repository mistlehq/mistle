import { Socket } from "node:net";
import { describe, expect, test } from "vitest";

import { startPostgresWithPgBouncer } from "../src/index.js";

function waitForTcpConnection(input: {
  host: string;
  port: number;
  timeoutMs: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let settled = false;

    const onError = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(input.timeoutMs, () => {
      onError(
        new Error(
          `Timed out waiting for TCP connection to ${input.host}:${String(input.port)} within ${String(input.timeoutMs)}ms.`,
        ),
      );
    });
    socket.once("error", onError);
    socket.connect(input.port, input.host, () => {
      if (settled) {
        return;
      }
      settled = true;
      socket.end();
      resolve();
    });
  });
}

describe("postgres + pgbouncer integration", () => {
  test("starts stack and exposes reachable direct and pooled endpoints", async () => {
    const databaseStack = await startPostgresWithPgBouncer();

    try {
      expect(databaseStack.directUrl).not.toBe("");
      expect(databaseStack.pooledUrl).not.toBe("");

      const directUrl = new URL(databaseStack.directUrl);
      const pooledUrl = new URL(databaseStack.pooledUrl);

      expect(directUrl.protocol).toBe("postgresql:");
      expect(pooledUrl.protocol).toBe("postgresql:");
      expect(directUrl.pathname).toBe(`/${databaseStack.postgres.databaseName}`);
      expect(pooledUrl.pathname).toBe(`/${databaseStack.postgres.databaseName}`);

      await waitForTcpConnection({
        host: databaseStack.postgres.host,
        port: databaseStack.postgres.port,
        timeoutMs: 2_000,
      });
      await waitForTcpConnection({
        host: databaseStack.pgbouncer.host,
        port: databaseStack.pgbouncer.port,
        timeoutMs: 2_000,
      });
    } finally {
      await databaseStack.stop();
    }
  }, 30_000);

  test("accepts custom credentials and pooling settings", async () => {
    const databaseStack = await startPostgresWithPgBouncer({
      databaseName: "mistle_custom",
      username: "mistle_user",
      password: "mistle_pass",
      poolMode: "session",
      defaultPoolSize: 7,
      maxClientConnections: 30,
    });

    try {
      const directUrl = new URL(databaseStack.directUrl);
      const pooledUrl = new URL(databaseStack.pooledUrl);

      expect(directUrl.username).toBe("mistle_user");
      expect(directUrl.password).toBe("mistle_pass");
      expect(pooledUrl.username).toBe("mistle_user");
      expect(pooledUrl.password).toBe("mistle_pass");
      expect(databaseStack.postgres.databaseName).toBe("mistle_custom");
      expect(databaseStack.pgbouncer.poolMode).toBe("session");
      expect(databaseStack.pgbouncer.defaultPoolSize).toBe(7);
      expect(databaseStack.pgbouncer.maxClientConnections).toBe(30);
    } finally {
      await databaseStack.stop();
    }
  }, 30_000);

  test("throws when stopping the same stack twice", async () => {
    const databaseStack = await startPostgresWithPgBouncer();
    await databaseStack.stop();

    await expect(databaseStack.stop()).rejects.toThrowError(
      "Postgres + PgBouncer stack was already stopped.",
    );
  }, 30_000);
});

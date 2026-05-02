import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { releaseReservedPort, reserveAvailablePort } from "./reserve-available-port.js";

const Host = "127.0.0.1";

const TemporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    TemporaryDirectories.splice(0).map(async (directoryPath) =>
      rm(directoryPath, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("reserveAvailablePort", () => {
  it("allocates unique ports across parallel callers sharing the same coordinator", async () => {
    const coordinatorDir = await createTemporaryDirectory();
    const reservations = await Promise.all(
      Array.from({ length: 32 }, () =>
        reserveAvailablePort({
          host: Host,
          coordinatorDir,
          range: {
            start: 45_000,
            end: 45_099,
          },
        }),
      ),
    );

    expect(new Set(reservations).size).toBe(reservations.length);
  });

  it("does not allocate a port that is already bound", async () => {
    const coordinatorDir = await createTemporaryDirectory();
    const server = await listen(Host, 45_120);

    try {
      await expect(
        reserveAvailablePort({
          host: Host,
          coordinatorDir,
          range: {
            start: 45_120,
            end: 45_120,
          },
        }),
      ).rejects.toThrow("Unable to reserve an available port");
    } finally {
      await close(server);
    }
  });

  it("does not reuse a live lease even when the port is currently unbound", async () => {
    const coordinatorDir = await createTemporaryDirectory();
    const firstPort = await reserveAvailablePort({
      host: Host,
      coordinatorDir,
      range: {
        start: 45_140,
        end: 45_141,
      },
    });
    const secondPort = await reserveAvailablePort({
      host: Host,
      coordinatorDir,
      range: {
        start: 45_140,
        end: 45_141,
      },
    });

    expect(secondPort).not.toBe(firstPort);
  });

  it("reuses a port after its lease is released", async () => {
    const coordinatorDir = await createTemporaryDirectory();
    const port = await reserveAvailablePort({
      host: Host,
      coordinatorDir,
      range: {
        start: 45_160,
        end: 45_160,
      },
    });

    await releaseReservedPort({
      host: Host,
      port,
      coordinatorDir,
    });

    await expect(
      reserveAvailablePort({
        host: Host,
        coordinatorDir,
        range: {
          start: 45_160,
          end: 45_160,
        },
      }),
    ).resolves.toBe(port);
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directoryPath = await mkdtemp(join(tmpdir(), "mistle-test-ports-"));
  TemporaryDirectories.push(directoryPath);
  return directoryPath;
}

async function listen(host: string, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(port, host, () => {
      resolve(server);
    });
  });
}

async function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

import { Socket } from "node:net";

import { describe, expect, test } from "vitest";

import { startValkey } from "../src/index.js";

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

describe("valkey service integration", () => {
  test("starts valkey and exposes a reachable endpoint", async () => {
    const valkeyService = await startValkey();

    try {
      expect(valkeyService.url).toBe(`redis://${valkeyService.host}:${String(valkeyService.port)}`);
      await waitForTcpConnection({
        host: valkeyService.host,
        port: valkeyService.port,
        timeoutMs: 2_000,
      });
    } finally {
      await valkeyService.stop();
    }
  }, 30_000);

  test("throws when stopping the same service twice", async () => {
    const valkeyService = await startValkey();
    await valkeyService.stop();

    await expect(valkeyService.stop()).rejects.toThrow("Valkey container was already stopped.");
  }, 30_000);
});

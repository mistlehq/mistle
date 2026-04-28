import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { systemSleeper } from "@mistle/time";
import { createManualScheduler, createMutableClock } from "@mistle/time/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
  dispatchSchedulesOnce,
  resolveDelayToNextMinuteMs,
  startDevScheduleDispatcher,
} from "./schedule-dispatcher-dev.js";

const ActiveServers: Array<{ close: () => Promise<void> }> = [];

function isAddressInfo(
  address: ReturnType<ReturnType<typeof createServer>["address"]>,
): address is AddressInfo {
  return typeof address === "object" && address !== null;
}

async function waitForRequestCount(input: {
  getRequestCount: () => number;
  expectedCount: number;
}): Promise<void> {
  const startedAt = Date.now();
  while (input.getRequestCount() < input.expectedCount) {
    if (Date.now() - startedAt > 1_000) {
      throw new Error(
        `Timed out waiting for ${String(input.expectedCount)} schedule dispatch requests.`,
      );
    }
    await systemSleeper.sleep(10);
  }
}

async function startDispatchServer(input: {
  handler: (request: IncomingMessage, response: ServerResponse) => void;
}): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer(input.handler);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!isAddressInfo(address)) {
    throw new Error("Expected dev schedule dispatcher test server to bind to a TCP port.");
  }

  const close = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
          return;
        }

        reject(error);
      });
    });
  };

  ActiveServers.push({ close });

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close,
  };
}

afterEach(async () => {
  while (ActiveServers.length > 0) {
    const server = ActiveServers.pop();
    if (server !== undefined) {
      await server.close();
    }
  }
});

describe("dev schedule dispatcher", () => {
  it("computes the next minute cadence used by cron-style dispatch", () => {
    expect(resolveDelayToNextMinuteMs(Date.UTC(2026, 3, 28, 1, 0, 0))).toBe(0);
    expect(resolveDelayToNextMinuteMs(Date.UTC(2026, 3, 28, 1, 0, 1))).toBe(59_000);
    expect(resolveDelayToNextMinuteMs(Date.UTC(2026, 3, 28, 1, 0, 59, 999))).toBe(1);
  });

  it("calls the internal dispatch endpoint with service-token auth", async () => {
    const requests: Array<{
      method: string | undefined;
      url: string | undefined;
      token: string | undefined;
    }> = [];
    const server = await startDispatchServer({
      handler: (request, response) => {
        requests.push({
          method: request.method,
          url: request.url,
          token: request.headers["x-mistle-service-token"]?.toString(),
        });
        response.writeHead(202);
        response.end("{}");
      },
    });

    await dispatchSchedulesOnce({
      baseUrl: server.baseUrl,
      serviceToken: "dev-schedule-token",
    });

    expect(requests).toEqual([
      {
        method: "POST",
        url: "/internal/schedules/dispatch",
        token: "dev-schedule-token",
      },
    ]);
  });

  it("retries startup failures before switching back to minute cadence", async () => {
    const clock = createMutableClock(Date.UTC(2026, 3, 28, 1, 0, 0));
    const scheduler = createManualScheduler(clock);
    const statuses = [503, 202, 202];
    const requestTimestamps: number[] = [];
    const server = await startDispatchServer({
      handler: (_request, response) => {
        requestTimestamps.push(clock.nowMs());
        const status = statuses.shift() ?? 202;
        response.writeHead(status);
        response.end("{}");
      },
    });

    const dispatcher = startDevScheduleDispatcher({
      clock,
      config: {
        baseUrl: server.baseUrl,
        serviceToken: "dev-schedule-token",
      },
      scheduler,
    });

    scheduler.runDue();
    await waitForRequestCount({
      expectedCount: 1,
      getRequestCount: () => requestTimestamps.length,
    });
    expect(requestTimestamps).toEqual([Date.UTC(2026, 3, 28, 1, 0, 0)]);
    expect(scheduler.pendingCount()).toBe(1);

    clock.advanceMs(1_000);
    scheduler.runDue();
    await waitForRequestCount({
      expectedCount: 2,
      getRequestCount: () => requestTimestamps.length,
    });
    expect(requestTimestamps).toEqual([
      Date.UTC(2026, 3, 28, 1, 0, 0),
      Date.UTC(2026, 3, 28, 1, 0, 1),
    ]);
    expect(scheduler.pendingCount()).toBe(1);

    clock.advanceMs(59_000);
    scheduler.runDue();
    await waitForRequestCount({
      expectedCount: 3,
      getRequestCount: () => requestTimestamps.length,
    });
    expect(requestTimestamps).toEqual([
      Date.UTC(2026, 3, 28, 1, 0, 0),
      Date.UTC(2026, 3, 28, 1, 0, 1),
      Date.UTC(2026, 3, 28, 1, 1, 0),
    ]);

    dispatcher.stop();
  });
});

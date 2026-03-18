import { describe, expect, it } from "vitest";

import { AsyncQueue } from "./async-queue.js";

describe("AsyncQueue", () => {
  it("returns queued items in insertion order", async () => {
    const queue = new AsyncQueue<string>();

    queue.push("first");
    queue.push("second");

    await expect(queue.next()).resolves.toBe("first");
    await expect(queue.next()).resolves.toBe("second");
  });

  it("delivers pushed items to pending waiters", async () => {
    const queue = new AsyncQueue<string>();
    const nextItem = queue.next();

    queue.push("value");

    await expect(nextItem).resolves.toBe("value");
  });

  it("rejects pending and future readers after failure", async () => {
    const queue = new AsyncQueue<string>();
    const expectedError = new Error("queue closed");
    const pendingItem = queue.next();

    queue.fail(expectedError);

    await expect(pendingItem).rejects.toThrow("queue closed");
    await expect(queue.next()).rejects.toThrow("queue closed");
  });

  it("removes aborted waiters before delivering later items", async () => {
    const queue = new AsyncQueue<string>();
    const abandonedWaitAbortController = new AbortController();
    const activeWaitAbortController = new AbortController();

    const abandonedWait = queue.next(abandonedWaitAbortController.signal);
    abandonedWaitAbortController.abort();

    await expect(abandonedWait).rejects.toThrow("This operation was aborted");

    const activeWait = queue.next(activeWaitAbortController.signal);
    queue.push("delivered");

    await expect(activeWait).resolves.toBe("delivered");
  });
});

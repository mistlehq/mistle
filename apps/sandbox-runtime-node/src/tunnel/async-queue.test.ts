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

  it("rejects aborted readers with the abort reason", async () => {
    const queue = new AsyncQueue<string>();
    const controller = new AbortController();

    const nextItem = queue.next(controller.signal);
    controller.abort(new Error("aborted by test"));

    await expect(nextItem).rejects.toThrow("aborted by test");
  });
});

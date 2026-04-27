import { describe, expect, it } from "vitest";

import { AsyncTaskTracker } from "./async-task-tracker.js";

function createDeferredTask(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolveTask: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveTask = resolve;
  });

  return {
    promise,
    resolve: () => {
      if (resolveTask === undefined) {
        throw new Error("Expected deferred task resolver to be initialized.");
      }
      resolveTask();
    },
  };
}

describe("AsyncTaskTracker", () => {
  it("waits for tracked tasks to settle", async () => {
    const tracker = new AsyncTaskTracker();
    const task = createDeferredTask();
    let drained = false;

    tracker.track(task.promise);
    const drainPromise = tracker.drain().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);

    task.resolve();
    await drainPromise;

    expect(drained).toBe(true);
  });

  it("continues draining tasks that are tracked while a drain is in progress", async () => {
    const tracker = new AsyncTaskTracker();
    const firstTask = createDeferredTask();
    const secondTask = createDeferredTask();
    let drained = false;

    tracker.track(
      firstTask.promise.then(() => {
        tracker.track(secondTask.promise);
      }),
    );

    const drainPromise = tracker.drain().then(() => {
      drained = true;
    });

    firstTask.resolve();
    await Promise.resolve();
    expect(drained).toBe(false);

    secondTask.resolve();
    await drainPromise;

    expect(drained).toBe(true);
  });

  it("does not reject drain when a tracked task rejects", async () => {
    const tracker = new AsyncTaskTracker();

    tracker.track(Promise.reject(new Error("task failed")));

    await expect(tracker.drain()).resolves.toBeUndefined();
  });
});

import type { Clock } from "../clock.js";
import type { Scheduler, TimerHandle } from "../scheduler.js";

type ManualSchedulerHandle = {
  __manualSchedulerId: number;
};

type ScheduledTask = {
  id: number;
  dueMs: number;
  callback: () => void;
  canceled: boolean;
};

export type ManualScheduler = Scheduler & {
  /**
   * Executes all callbacks whose due time is <= current clock time.
   * Returns the number of callbacks run in this invocation.
   */
  runDue: () => number;
  /**
   * Returns the number of currently scheduled non-canceled callbacks.
   */
  pendingCount: () => number;
};

function isManualSchedulerHandle(value: unknown): value is ManualSchedulerHandle {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("__manualSchedulerId" in value)) {
    return false;
  }

  return typeof value.__manualSchedulerId === "number";
}

function toTimerHandle(id: number): TimerHandle {
  return { __manualSchedulerId: id } as unknown as TimerHandle;
}

function fromTimerHandle(handle: TimerHandle): number | undefined {
  if (!isManualSchedulerHandle(handle)) {
    return undefined;
  }

  return handle.__manualSchedulerId;
}

/**
 * Creates a deterministic scheduler backed by a provided clock.
 * Time does not progress implicitly; tests advance the clock and call `runDue()`.
 */
export function createManualScheduler(clock: Clock): ManualScheduler {
  let nextId = 1;
  let tasks: ScheduledTask[] = [];

  return {
    schedule: (callback, delayMs) => {
      const id = nextId;
      nextId += 1;

      const dueMs = clock.nowMs() + Math.max(0, delayMs);

      tasks.push({
        id,
        dueMs,
        callback,
        canceled: false,
      });

      return toTimerHandle(id);
    },
    cancel: (handle) => {
      const id = fromTimerHandle(handle);
      if (id === undefined) {
        return;
      }

      tasks = tasks.map((task) => {
        if (task.id !== id) {
          return task;
        }

        return {
          ...task,
          canceled: true,
        };
      });
    },
    runDue: () => {
      const nowMs = clock.nowMs();
      const dueTasks = tasks
        .filter((task) => !task.canceled && task.dueMs <= nowMs)
        .sort((left, right) => left.dueMs - right.dueMs || left.id - right.id);

      for (const task of dueTasks) {
        task.canceled = true;
        task.callback();
      }

      tasks = tasks.filter((task) => !task.canceled);

      return dueTasks.length;
    },
    pendingCount: () => tasks.filter((task) => !task.canceled).length,
  };
}

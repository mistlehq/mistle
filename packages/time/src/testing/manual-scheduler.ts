import type { Clock } from "../clock.js";
import type { Scheduler, TimerHandle } from "../scheduler.js";

type ScheduledTask = {
  id: number;
  dueMs: number;
  callback: () => void;
  handle: TimerHandle;
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

function createTimerHandle(): TimerHandle {
  const handle = setTimeout(() => {
    // The manual scheduler controls callback execution via runDue().
  }, 2_147_483_647);
  clearTimeout(handle);
  return handle;
}

/**
 * Creates a deterministic scheduler backed by a provided clock.
 * Time does not progress implicitly; tests advance the clock and call `runDue()`.
 */
export function createManualScheduler(clock: Clock): ManualScheduler {
  let nextId = 1;
  let tasks: ScheduledTask[] = [];
  const taskIdsByHandle = new Map<TimerHandle, number>();

  return {
    schedule: (callback, delayMs) => {
      const id = nextId;
      nextId += 1;
      const handle = createTimerHandle();

      const dueMs = clock.nowMs() + Math.max(0, delayMs);

      tasks.push({
        id,
        dueMs,
        callback,
        handle,
        canceled: false,
      });
      taskIdsByHandle.set(handle, id);

      return handle;
    },
    cancel: (handle) => {
      const id = taskIdsByHandle.get(handle);
      if (id === undefined) {
        return;
      }
      taskIdsByHandle.delete(handle);

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
        taskIdsByHandle.delete(task.handle);
        task.canceled = true;
        task.callback();
      }

      tasks = tasks.filter((task) => !task.canceled);

      return dueTasks.length;
    },
    pendingCount: () => tasks.filter((task) => !task.canceled).length,
  };
}

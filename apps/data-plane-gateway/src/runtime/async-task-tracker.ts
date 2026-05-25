import { systemSleeper } from "@mistle/time";

export type AsyncTaskDrainResult = {
  activeTaskCount: number;
  timedOut: boolean;
};

export type AsyncTaskDrainOptions = {
  timeoutMs?: number;
};

export class AsyncTaskTracker {
  readonly #activeTasks = new Set<Promise<void>>();

  public track(task: Promise<void>): void {
    const trackedTask = task.finally(() => {
      this.#activeTasks.delete(trackedTask);
    });

    this.#activeTasks.add(trackedTask);
    void trackedTask.catch(() => {
      // Callers own error handling; the tracker only prevents orphaned rejections while draining.
    });
  }

  public async drain(options: AsyncTaskDrainOptions = {}): Promise<AsyncTaskDrainResult> {
    if (options.timeoutMs !== undefined) {
      return this.drainWithTimeout(options.timeoutMs);
    }

    await this.drainAll();
    return {
      activeTaskCount: this.#activeTasks.size,
      timedOut: false,
    };
  }

  private async drainAll(): Promise<void> {
    while (this.#activeTasks.size > 0) {
      await Promise.allSettled([...this.#activeTasks]);
    }
  }

  private async drainWithTimeout(timeoutMs: number): Promise<AsyncTaskDrainResult> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error("Async task drain timeout must be a positive integer.");
    }

    const timeoutPromise = systemSleeper.sleep(timeoutMs).then(() => ({
      activeTaskCount: this.#activeTasks.size,
      timedOut: true,
    }));
    const drainPromise = this.drainAll().then(() => ({
      activeTaskCount: this.#activeTasks.size,
      timedOut: false,
    }));

    return Promise.race([drainPromise, timeoutPromise]);
  }
}

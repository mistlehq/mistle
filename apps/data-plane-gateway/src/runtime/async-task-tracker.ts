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

  public async drain(): Promise<void> {
    while (this.#activeTasks.size > 0) {
      await Promise.allSettled([...this.#activeTasks]);
    }
  }
}

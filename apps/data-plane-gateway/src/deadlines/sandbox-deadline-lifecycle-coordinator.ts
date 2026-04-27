/**
 * Serializes deadline lifecycle mutations for a sandbox instance.
 *
 * The gateway has multiple async paths that can touch deadlines for the same
 * sandbox: bootstrap attach, bootstrap disconnect, connection presence, and
 * bootstrap keepalive. Running them through one per-sandbox queue prevents a
 * stale idle touch from racing after disconnect cleanup.
 */
export class SandboxDeadlineLifecycleCoordinator {
  private readonly transitionsBySandboxInstanceId = new Map<string, Promise<void>>();

  public async enqueue(input: {
    sandboxInstanceId: string;
    operation: () => Promise<void>;
  }): Promise<void> {
    const previousTransition = this.transitionsBySandboxInstanceId.get(input.sandboxInstanceId);
    const currentTransition = (previousTransition ?? Promise.resolve())
      .catch(() => {
        // Keep later lifecycle transitions flowing after an earlier failure.
      })
      .then(input.operation);

    this.transitionsBySandboxInstanceId.set(input.sandboxInstanceId, currentTransition);

    try {
      await currentTransition;
    } finally {
      if (this.transitionsBySandboxInstanceId.get(input.sandboxInstanceId) === currentTransition) {
        this.transitionsBySandboxInstanceId.delete(input.sandboxInstanceId);
      }
    }
  }
}

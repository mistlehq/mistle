export const SandboxInstanceStatuses = Object.freeze({
  PENDING: "pending",
  STARTING: "starting",
  STARTED: "started",
  INITIALIZING: "initializing",
  RUNNING: "running",
  RECONNECTING: "reconnecting",
  STOPPING: "stopping",
  STOPPED: "stopped",
  FAILED: "failed",
});

export type SandboxInstanceStatus =
  (typeof SandboxInstanceStatuses)[keyof typeof SandboxInstanceStatuses];

export type SandboxInstanceLifecycleStatus = SandboxInstanceStatus;

export function isSandboxInstanceStatus(input: string): input is SandboxInstanceStatus {
  switch (input) {
    case SandboxInstanceStatuses.PENDING:
    case SandboxInstanceStatuses.STARTING:
    case SandboxInstanceStatuses.STARTED:
    case SandboxInstanceStatuses.INITIALIZING:
    case SandboxInstanceStatuses.RUNNING:
    case SandboxInstanceStatuses.RECONNECTING:
    case SandboxInstanceStatuses.STOPPING:
    case SandboxInstanceStatuses.STOPPED:
    case SandboxInstanceStatuses.FAILED:
      return true;
    default:
      return false;
  }
}

export function assertSandboxInstanceLifecycleStatus(
  input: string,
): asserts input is SandboxInstanceStatus {
  if (!isSandboxInstanceStatus(input)) {
    throw new Error(`Unsupported sandbox instance status '${input}'.`);
  }
}

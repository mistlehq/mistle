export type SessionStatusKind =
  | "loading"
  | "starting"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "stopped"
  | "failed";

export type SessionStatusSandboxLifecycle =
  | "pending"
  | "starting"
  | "running"
  | "resuming"
  | "stopped"
  | "failed"
  | null;

export type SandboxLifecycleStatus = Exclude<SessionStatusSandboxLifecycle, "resuming" | null>;

export function resolveSessionStatus(input: {
  sandboxLifecycleStatus: SessionStatusSandboxLifecycle;
  sandboxConnectable: boolean | null;
  isStatusLoading: boolean;
  isReconnecting: boolean;
}): SessionStatusKind {
  if (input.isReconnecting) {
    return "reconnecting";
  }

  if (input.isStatusLoading || input.sandboxLifecycleStatus === null) {
    return "loading";
  }

  if (input.sandboxLifecycleStatus === "failed") {
    return "failed";
  }

  if (input.sandboxLifecycleStatus === "stopped") {
    return "stopped";
  }

  if (
    input.sandboxLifecycleStatus === "pending" ||
    input.sandboxLifecycleStatus === "starting" ||
    input.sandboxLifecycleStatus === "resuming"
  ) {
    return "starting";
  }

  return input.sandboxConnectable ? "connected" : "connecting";
}

import type { SessionBootstrapState } from "./use-session-bootstrap.js";

export function resolveSessionBootstrapState(input: {
  activeConnectionKey: string | null;
  activeThreadSyncKey: string | null;
  configError: Error | null;
  isCurrentConnectionBootstrapping: boolean;
  modelsError: Error | null;
  threadSyncFailureMessage: string | null;
}): SessionBootstrapState {
  if (input.activeConnectionKey === null || input.activeThreadSyncKey === null) {
    return { status: "disconnected" };
  }

  if (input.modelsError !== null) {
    return {
      status: "failed",
      message: input.modelsError.message,
    };
  }

  if (input.configError !== null) {
    return {
      status: "failed",
      message: input.configError.message,
    };
  }

  if (input.threadSyncFailureMessage !== null) {
    return {
      status: "failed",
      message: input.threadSyncFailureMessage,
    };
  }

  if (input.isCurrentConnectionBootstrapping) {
    return { status: "bootstrapping" };
  }

  return { status: "ready" };
}

import type { SessionBootstrapPhase } from "./use-session-bootstrap.js";

export function resolveSessionBootstrapState(input: {
  activeConnectionKey: string | null;
  activeThreadSyncKey: string | null;
  bootstrapDataError: Error | null;
  isCurrentConnectionBootstrapping: boolean;
  modelsError: Error | null;
  threadSyncFailureMessage: string | null;
}): SessionBootstrapPhase {
  if (input.activeConnectionKey === null || input.activeThreadSyncKey === null) {
    return { status: "unavailable" };
  }

  if (input.modelsError !== null) {
    return {
      status: "failed",
      message: input.modelsError.message,
    };
  }

  if (input.bootstrapDataError !== null) {
    return {
      status: "failed",
      message: input.bootstrapDataError.message,
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

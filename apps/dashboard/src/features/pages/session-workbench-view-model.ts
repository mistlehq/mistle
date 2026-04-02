import {
  resolveSandboxStatusBadgeUi,
  type SandboxStatusBadgeUi,
  type WorkbenchSandboxLifecycleStatus,
} from "./sandbox-status-presentation.js";

export function resolveSandboxHeaderStatusUi(input: {
  sandboxLifecycleStatus: WorkbenchSandboxLifecycleStatus;
}): SandboxStatusBadgeUi {
  return resolveSandboxStatusBadgeUi(input.sandboxLifecycleStatus);
}

export function hasSessionTopAlert(input: {
  hasSandboxStatusError: boolean;
  lifecycleErrorMessage: string | null;
  reconnectMessage: string | null;
  sandboxFailureMessage: string | null;
  stoppedSessionMessage: string | null;
}): boolean {
  return (
    input.hasSandboxStatusError ||
    input.lifecycleErrorMessage !== null ||
    input.reconnectMessage !== null ||
    input.sandboxFailureMessage !== null ||
    input.stoppedSessionMessage !== null
  );
}

export function shouldShowResumeAction(input: { requiresManualResume: boolean }): boolean {
  return input.requiresManualResume;
}

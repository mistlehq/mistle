import {
  resolveSandboxStatusBadgeUi,
  type SandboxStatusBadgeUi,
} from "./sandbox-status-presentation.js";
import type {
  SandboxStatusReadState,
  WorkbenchSandboxLifecycleStatus,
} from "./session-workbench-state.js";

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

export function resolveSessionWorkbenchHeaderStatusUi(input: {
  sandboxLifecycleStatus: WorkbenchSandboxLifecycleStatus;
  sandboxStatusReadState: SandboxStatusReadState;
}): SandboxStatusBadgeUi {
  return input.sandboxStatusReadState === "loading"
    ? resolveSandboxStatusBadgeUi(null)
    : resolveSandboxStatusBadgeUi(input.sandboxLifecycleStatus);
}

export function shouldShowResumeAction(input: { requiresManualResume: boolean }): boolean {
  return input.requiresManualResume;
}

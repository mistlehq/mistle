export function isConnectableSandboxStatus(
  sandboxStatus: string | null,
): sandboxStatus is "starting" | "running" | "stopped" {
  return sandboxStatus === "starting" || sandboxStatus === "running" || sandboxStatus === "stopped";
}

export function shouldAutoConnectSession(input: {
  sandboxInstanceId: string | null;
  sandboxStatus: string | null;
  connected: boolean;
  isStartingSession: boolean;
  hasAttemptedAutoConnect: boolean;
  hasStartError: boolean;
}): boolean {
  return !(
    input.sandboxInstanceId === null ||
    !isConnectableSandboxStatus(input.sandboxStatus) ||
    input.connected ||
    input.isStartingSession ||
    input.hasAttemptedAutoConnect ||
    input.hasStartError
  );
}

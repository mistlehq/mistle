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
    input.sandboxStatus !== "running" ||
    input.connected ||
    input.isStartingSession ||
    input.hasAttemptedAutoConnect ||
    input.hasStartError
  );
}

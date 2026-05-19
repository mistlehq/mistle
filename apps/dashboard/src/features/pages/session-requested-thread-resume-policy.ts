export type RequestedThreadResumeAttempt = {
  sandboxInstanceId: string | null;
  threadId: string;
};

export function shouldAttemptRequestedThreadResume(input: {
  activeThreadId: string | null;
  hasInFlightThreadNavigation: boolean;
  previousAttempt: RequestedThreadResumeAttempt | null;
  providerThreadId: string | null;
  requestedThreadId: string | null;
  sandboxInstanceId: string | null;
}): boolean {
  if (input.requestedThreadId === null) {
    return false;
  }

  if (input.hasInFlightThreadNavigation) {
    return false;
  }

  if (input.providerThreadId !== null) {
    return false;
  }

  if (input.requestedThreadId === input.activeThreadId) {
    return false;
  }

  return (
    input.previousAttempt === null ||
    input.previousAttempt.sandboxInstanceId !== input.sandboxInstanceId ||
    input.previousAttempt.threadId !== input.requestedThreadId
  );
}

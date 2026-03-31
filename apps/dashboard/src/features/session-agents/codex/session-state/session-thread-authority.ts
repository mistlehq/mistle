export type CodexCliLaunchTarget =
  | {
      type: "resume";
      threadId: string;
    }
  | {
      type: "start_new";
      shouldClearActiveThreadId: boolean;
    };

export function isCodexThreadResumable(input: { turnCount: number }): boolean {
  return input.turnCount > 0;
}

export function resolveCodexCliLaunchTarget(input: {
  activeThreadId: string | null;
  turnCount: number | null;
}): CodexCliLaunchTarget {
  if (input.activeThreadId === null) {
    return {
      type: "start_new",
      shouldClearActiveThreadId: false,
    };
  }

  if (input.turnCount !== null && isCodexThreadResumable({ turnCount: input.turnCount })) {
    return {
      type: "resume",
      threadId: input.activeThreadId,
    };
  }

  return {
    type: "start_new",
    shouldClearActiveThreadId: true,
  };
}

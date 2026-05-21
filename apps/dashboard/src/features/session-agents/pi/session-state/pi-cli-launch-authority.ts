import type { PiSessionState } from "@mistle/integrations-definitions/agent-runtimes/pi/client";

import type { SessionCliLaunchTarget } from "../../session-runtime-cli-launch.js";

export function isPiSessionActivelyWorking(
  sessionState: Pick<PiSessionState, "isCompacting" | "isStreaming" | "pendingMessageCount">,
): boolean {
  return (
    sessionState.isStreaming || sessionState.isCompacting || sessionState.pendingMessageCount > 0
  );
}

export function resolvePiCliLaunchTarget(input: {
  activeSessionFile: string | null;
  hasActiveWork: boolean;
  messageCount: number | null;
}): SessionCliLaunchTarget {
  if (
    input.activeSessionFile !== null &&
    (input.hasActiveWork || (input.messageCount !== null && input.messageCount > 0))
  ) {
    return {
      type: "resume",
      threadId: input.activeSessionFile,
    };
  }

  return {
    type: "start_new",
    shouldClearActiveThreadId: input.activeSessionFile !== null,
  };
}

export function resolveStablePiCliLaunchTarget(input: {
  activeSessionFile: string | null;
  currentActiveSessionFile: string | null;
  hasActiveWork: boolean;
  messageCount: number | null;
}): SessionCliLaunchTarget | null {
  if (input.activeSessionFile !== input.currentActiveSessionFile) {
    return null;
  }

  return resolvePiCliLaunchTarget({
    activeSessionFile: input.activeSessionFile,
    hasActiveWork: input.hasActiveWork,
    messageCount: input.messageCount,
  });
}

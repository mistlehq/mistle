import { AsyncQueue } from "./async-queue.js";
import type { TunnelSocketMessage } from "./connect-request.js";
import type { PtySession } from "./pty-session.js";

export type ActiveTunnelStreamRelay = {
  primaryStreamId: number;
  channelKind: "agent" | "pty";
  messages: AsyncQueue<TunnelSocketMessage>;
};

export type ActiveTunnelStreamRelayResult =
  | {
      relay: ActiveTunnelStreamRelay;
      error?: Error;
      updatesPtySession: false;
    }
  | {
      relay: ActiveTunnelStreamRelay;
      error?: Error;
      ptySession: PtySession | undefined;
      updatesPtySession: true;
    };

export function finishActiveTunnelStreamRelay(
  activeRelaysByStreamId: Map<number, ActiveTunnelStreamRelay>,
  activePtyRelay: ActiveTunnelStreamRelay | undefined,
  activePtySession: PtySession | undefined,
  result: ActiveTunnelStreamRelayResult,
): {
  activePtyRelay: ActiveTunnelStreamRelay | undefined;
  activePtySession: PtySession | undefined;
} {
  for (const [streamId, relay] of activeRelaysByStreamId.entries()) {
    if (relay === result.relay) {
      activeRelaysByStreamId.delete(streamId);
    }
  }

  return {
    activePtyRelay: activePtyRelay === result.relay ? undefined : activePtyRelay,
    activePtySession: result.updatesPtySession ? result.ptySession : activePtySession,
  };
}

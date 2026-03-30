import { AsyncQueue } from "./async-queue.js";
import type { TunnelSocketMessage } from "./connect-request.js";
import type { PtySession } from "./pty-session.js";

export type ActiveTunnelStreamRelay = {
  primaryStreamId: number;
  channelKind: "agent" | "fileUpload" | "pty";
  messages: AsyncQueue<TunnelSocketMessage>;
  ptySessionId?: string;
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
      ptySessionId: string;
      ptySession: PtySession | undefined;
      updatesPtySession: true;
    };

export function finishActiveTunnelStreamRelay(
  activeRelaysByStreamId: Map<number, ActiveTunnelStreamRelay>,
  activePtyRelaysBySessionId: Map<string, ActiveTunnelStreamRelay>,
  activePtySessionsBySessionId: Map<string, PtySession>,
  result: ActiveTunnelStreamRelayResult,
): {
  activePtyRelaysBySessionId: Map<string, ActiveTunnelStreamRelay>;
  activePtySessionsBySessionId: Map<string, PtySession>;
} {
  for (const [streamId, relay] of activeRelaysByStreamId.entries()) {
    if (relay === result.relay) {
      activeRelaysByStreamId.delete(streamId);
    }
  }

  if (result.updatesPtySession) {
    if (activePtyRelaysBySessionId.get(result.ptySessionId) === result.relay) {
      activePtyRelaysBySessionId.delete(result.ptySessionId);
    }

    if (result.ptySession === undefined) {
      activePtySessionsBySessionId.delete(result.ptySessionId);
    } else {
      activePtySessionsBySessionId.set(result.ptySessionId, result.ptySession);
    }
  }

  return {
    activePtyRelaysBySessionId,
    activePtySessionsBySessionId,
  };
}

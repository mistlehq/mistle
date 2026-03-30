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
  const nextActivePtyRelaysBySessionId = new Map(activePtyRelaysBySessionId);
  const nextActivePtySessionsBySessionId = new Map(activePtySessionsBySessionId);

  for (const [streamId, relay] of activeRelaysByStreamId.entries()) {
    if (relay === result.relay) {
      activeRelaysByStreamId.delete(streamId);
    }
  }

  if (result.updatesPtySession) {
    if (nextActivePtyRelaysBySessionId.get(result.ptySessionId) === result.relay) {
      nextActivePtyRelaysBySessionId.delete(result.ptySessionId);
    }

    if (result.ptySession === undefined) {
      nextActivePtySessionsBySessionId.delete(result.ptySessionId);
    } else {
      nextActivePtySessionsBySessionId.set(result.ptySessionId, result.ptySession);
    }
  }

  return {
    activePtyRelaysBySessionId: nextActivePtyRelaysBySessionId,
    activePtySessionsBySessionId: nextActivePtySessionsBySessionId,
  };
}

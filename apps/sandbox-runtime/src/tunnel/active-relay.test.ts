import { describe, expect, it } from "vitest";

import { finishActiveTunnelStreamRelay, type ActiveTunnelStreamRelay } from "./active-relay.js";
import { AsyncQueue } from "./async-queue.js";
import type { TunnelSocketMessage } from "./connect-request.js";
import type { PtySession } from "./pty-session.js";

function createRelay(
  primaryStreamId: number,
  channelKind: "agent" | "pty",
): ActiveTunnelStreamRelay {
  return {
    primaryStreamId,
    channelKind,
    messages: new AsyncQueue<TunnelSocketMessage>(),
  };
}

describe("finishActiveTunnelStreamRelay", () => {
  it("removes finished relay bindings and preserves the current PTY session for agent relays", () => {
    const agentRelay = createRelay(11, "agent");
    const ptyRelay = createRelay(21, "pty");
    const activeRelaysByStreamId = new Map<number, ActiveTunnelStreamRelay>([
      [11, agentRelay],
      [21, ptyRelay],
      [22, ptyRelay],
    ]);
    const activePtySession = undefined as PtySession | undefined;

    const nextState = finishActiveTunnelStreamRelay(
      activeRelaysByStreamId,
      ptyRelay,
      activePtySession,
      {
        relay: agentRelay,
        updatesPtySession: false,
      },
    );

    expect(activeRelaysByStreamId.has(11)).toBe(false);
    expect(activeRelaysByStreamId.has(21)).toBe(true);
    expect(nextState.activePtyRelay).toBe(ptyRelay);
    expect(nextState.activePtySession).toBeUndefined();
  });

  it("clears the active PTY relay and updates the PTY session when the PTY relay finishes", () => {
    const ptyRelay = createRelay(21, "pty");
    const replacementPtySession = undefined as PtySession | undefined;
    const activeRelaysByStreamId = new Map<number, ActiveTunnelStreamRelay>([
      [21, ptyRelay],
      [22, ptyRelay],
    ]);

    const nextState = finishActiveTunnelStreamRelay(
      activeRelaysByStreamId,
      ptyRelay,
      replacementPtySession,
      {
        relay: ptyRelay,
        ptySession: replacementPtySession,
        updatesPtySession: true,
      },
    );

    expect(activeRelaysByStreamId.size).toBe(0);
    expect(nextState.activePtyRelay).toBeUndefined();
    expect(nextState.activePtySession).toBeUndefined();
  });
});

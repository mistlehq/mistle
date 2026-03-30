import { describe, expect, it } from "vitest";

import { finishActiveTunnelStreamRelay, type ActiveTunnelStreamRelay } from "./active-relay.js";
import { AsyncQueue } from "./async-queue.js";
import type { TunnelSocketMessage } from "./connect-request.js";
import type { PtySession } from "./pty-session.js";

function createRelay(
  primaryStreamId: number,
  channelKind: "agent" | "fileUpload" | "pty",
  ptySessionId = "terminal",
): ActiveTunnelStreamRelay {
  return {
    primaryStreamId,
    channelKind,
    messages: new AsyncQueue<TunnelSocketMessage>(),
    ...(channelKind === "pty" ? { ptySessionId } : {}),
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
    const activePtyRelaysBySessionId = new Map<string, ActiveTunnelStreamRelay>([
      ["terminal", ptyRelay],
    ]);
    const activePtySessionsBySessionId = new Map<string, PtySession>();

    const nextState = finishActiveTunnelStreamRelay(
      activeRelaysByStreamId,
      activePtyRelaysBySessionId,
      activePtySessionsBySessionId,
      {
        relay: agentRelay,
        updatesPtySession: false,
      },
    );

    expect(activeRelaysByStreamId.has(11)).toBe(false);
    expect(activeRelaysByStreamId.has(21)).toBe(true);
    expect(nextState.activePtyRelaysBySessionId.get("terminal")).toBe(ptyRelay);
    expect(nextState.activePtySessionsBySessionId.size).toBe(0);
  });

  it("clears the active PTY relay and updates the PTY session when the PTY relay finishes", () => {
    const ptyRelay = createRelay(21, "pty");
    const replacementPtySession = undefined as PtySession | undefined;
    const activeRelaysByStreamId = new Map<number, ActiveTunnelStreamRelay>([
      [21, ptyRelay],
      [22, ptyRelay],
    ]);
    const activePtyRelaysBySessionId = new Map<string, ActiveTunnelStreamRelay>([
      ["terminal", ptyRelay],
    ]);
    const activePtySessionsBySessionId = new Map<string, PtySession>();

    const nextState = finishActiveTunnelStreamRelay(
      activeRelaysByStreamId,
      activePtyRelaysBySessionId,
      activePtySessionsBySessionId,
      {
        relay: ptyRelay,
        ptySessionId: "terminal",
        ptySession: replacementPtySession,
        updatesPtySession: true,
      },
    );

    expect(activeRelaysByStreamId.size).toBe(0);
    expect(nextState.activePtyRelaysBySessionId.size).toBe(0);
    expect(nextState.activePtySessionsBySessionId.size).toBe(0);
  });

  it("returns independent PTY session maps that preserve other active PTY sessions", () => {
    const terminalRelay = createRelay(21, "pty", "terminal");
    const cliRelay = createRelay(31, "pty", "cli");
    const activeRelaysByStreamId = new Map<number, ActiveTunnelStreamRelay>([
      [21, terminalRelay],
      [22, terminalRelay],
      [31, cliRelay],
      [32, cliRelay],
    ]);
    const activePtyRelaysBySessionId = new Map<string, ActiveTunnelStreamRelay>([
      ["terminal", terminalRelay],
      ["cli", cliRelay],
    ]);
    const activePtySessionsBySessionId = new Map<string, PtySession>();

    const nextState = finishActiveTunnelStreamRelay(
      activeRelaysByStreamId,
      activePtyRelaysBySessionId,
      activePtySessionsBySessionId,
      {
        relay: cliRelay,
        ptySessionId: "cli",
        ptySession: undefined,
        updatesPtySession: true,
      },
    );

    expect(nextState.activePtyRelaysBySessionId).not.toBe(activePtyRelaysBySessionId);
    expect(nextState.activePtySessionsBySessionId).not.toBe(activePtySessionsBySessionId);
    expect(nextState.activePtyRelaysBySessionId.get("terminal")).toBe(terminalRelay);
    expect(nextState.activePtyRelaysBySessionId.has("cli")).toBe(false);
    expect(nextState.activePtySessionsBySessionId.has("cli")).toBe(false);
  });
});

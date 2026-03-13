import { describe, expect, it } from "vitest";

import type {
  PTYExitEvent,
  StreamControlMessage,
  StreamEventMessage,
  StreamOpen,
  StreamSignalMessage,
} from "./stream-protocol.js";

describe("stream protocol message shapes", () => {
  it("represents PTY open messages", () => {
    const message: StreamOpen = {
      type: "stream.open",
      streamId: 17,
      channel: {
        kind: "pty",
        session: "create",
        cwd: "/workspace",
        cols: 120,
        rows: 40,
      },
    };

    expect(message.channel.kind).toBe("pty");
    if (message.channel.kind !== "pty") {
      throw new Error("expected PTY channel");
    }
    expect(message.channel.session).toBe("create");
  });

  it("represents PTY resize signals", () => {
    const message: StreamSignalMessage = {
      type: "stream.signal",
      streamId: 17,
      signal: {
        type: "pty.resize",
        cols: 140,
        rows: 48,
      },
    };

    expect(message.signal.cols).toBe(140);
    expect(message.signal.rows).toBe(48);
  });

  it("represents PTY exit events", () => {
    const event: PTYExitEvent = {
      type: "pty.exit",
      exitCode: 0,
    };
    const message: StreamEventMessage = {
      type: "stream.event",
      streamId: 17,
      event,
    };

    expect(message.event.exitCode).toBe(0);
  });

  it("allows agent opens in the control message union", () => {
    const message: StreamControlMessage = {
      type: "stream.open",
      streamId: 21,
      channel: {
        kind: "agent",
      },
    };

    expect(message.type).toBe("stream.open");
    expect(message.channel.kind).toBe("agent");
  });
});

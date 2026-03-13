import { describe, expect, it } from "vitest";

import { parseStreamControlMessage } from "./stream-protocol.js";

describe("stream control message parser", () => {
  it("parses pty stream opens into the shared control shape", () => {
    const message = parseStreamControlMessage(
      JSON.stringify({
        type: "stream.open",
        streamId: 17,
        channel: {
          kind: "pty",
          session: "create",
          cols: 120,
          rows: 40,
          cwd: "/workspace/repo",
          ignored: true,
        },
      }),
    );

    expect(message).toEqual({
      type: "stream.open",
      streamId: 17,
      channel: {
        kind: "pty",
        session: "create",
        cols: 120,
        rows: 40,
        cwd: "/workspace/repo",
      },
    });
  });

  it("rejects malformed pty stream opens", () => {
    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.open",
          streamId: 17,
          channel: {
            kind: "pty",
            session: "create",
            cols: "120",
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("parses stream events and resets", () => {
    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.event",
          streamId: 8,
          event: {
            type: "pty.exit",
            exitCode: 0,
          },
        }),
      ),
    ).toEqual({
      type: "stream.event",
      streamId: 8,
      event: {
        type: "pty.exit",
        exitCode: 0,
      },
    });

    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.reset",
          streamId: 8,
          code: "target_closed",
          message: "target closed stream",
        }),
      ),
    ).toEqual({
      type: "stream.reset",
      streamId: 8,
      code: "target_closed",
      message: "target closed stream",
    });
  });
});

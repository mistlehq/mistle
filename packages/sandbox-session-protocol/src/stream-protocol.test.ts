import { describe, expect, it } from "vitest";

import {
  parseBootstrapControlMessage,
  parseStreamControlMessage,
  parseTelemetryControlMessage,
} from "./stream-protocol.js";

describe("stream control message parser", () => {
  it("parses pty stream opens into the shared control shape", () => {
    const message = parseStreamControlMessage(
      JSON.stringify({
        type: "stream.open",
        streamId: 17,
        channel: {
          kind: "pty",
          session: "create",
          ptySessionId: "terminal",
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
        ptySessionId: "terminal",
        cols: 120,
        rows: 40,
        cwd: "/workspace/repo",
      },
    });
  });

  it("parses pty stream opens with an explicit startup command", () => {
    const message = parseStreamControlMessage(
      JSON.stringify({
        type: "stream.open",
        streamId: 18,
        channel: {
          kind: "pty",
          session: "create",
          ptySessionId: "cli",
          cols: 120,
          rows: 40,
          command: "codex",
          args: ["resume", "--remote", "ws://127.0.0.1:4500", "thread_123"],
        },
      }),
    );

    expect(message).toEqual({
      type: "stream.open",
      streamId: 18,
      channel: {
        kind: "pty",
        session: "create",
        ptySessionId: "cli",
        cols: 120,
        rows: 40,
        command: "codex",
        args: ["resume", "--remote", "ws://127.0.0.1:4500", "thread_123"],
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

  it("parses file upload stream opens", () => {
    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.open",
          streamId: 23,
          channel: {
            kind: "fileUpload",
            threadId: "thread_123",
            mimeType: "image/png",
            originalFilename: "screenshot.png",
            sizeBytes: 1024,
            ignored: true,
          },
        }),
      ),
    ).toEqual({
      type: "stream.open",
      streamId: 23,
      channel: {
        kind: "fileUpload",
        threadId: "thread_123",
        mimeType: "image/png",
        originalFilename: "screenshot.png",
        sizeBytes: 1024,
      },
    });
  });

  it("rejects malformed file upload stream opens", () => {
    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.open",
          streamId: 23,
          channel: {
            kind: "fileUpload",
            threadId: "thread_123",
            mimeType: "image/png",
            originalFilename: "screenshot.png",
            sizeBytes: "1024",
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
          type: "stream.complete",
          streamId: 8,
        }),
      ),
    ).toEqual({
      type: "stream.complete",
      streamId: 8,
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

    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.event",
          streamId: 9,
          event: {
            type: "fileUpload.completed",
            attachmentId: "att_123",
            threadId: "thread_123",
            originalFilename: "screenshot.png",
            mimeType: "image/png",
            sizeBytes: 1024,
            path: "/tmp/attachments/thread_123/upload.png",
          },
        }),
      ),
    ).toEqual({
      type: "stream.event",
      streamId: 9,
      event: {
        type: "fileUpload.completed",
        attachmentId: "att_123",
        threadId: "thread_123",
        originalFilename: "screenshot.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        path: "/tmp/attachments/thread_123/upload.png",
      },
    });
  });

  it("rejects malformed stream.complete messages", () => {
    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "stream.complete",
          streamId: "8",
        }),
      ),
    ).toBeUndefined();
  });

  it("parses telemetry control messages", () => {
    expect(
      parseTelemetryControlMessage(
        JSON.stringify({
          type: "telemetry.open",
          streamId: 31,
          signal: "logs",
          format: "mistle.sandbox-runtime.log.v1",
        }),
      ),
    ).toEqual({
      type: "telemetry.open",
      streamId: 31,
      signal: "logs",
      format: "mistle.sandbox-runtime.log.v1",
    });

    expect(
      parseTelemetryControlMessage(
        JSON.stringify({
          type: "telemetry.reset",
          streamId: 31,
          code: "telemetry_stream_not_found",
          message: "stream not found",
        }),
      ),
    ).toEqual({
      type: "telemetry.reset",
      streamId: 31,
      code: "telemetry_stream_not_found",
      message: "stream not found",
    });
  });

  it("allows bootstrap telemetry open and close messages", () => {
    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "telemetry.open",
          streamId: 41,
          signal: "logs",
          format: "mistle.sandbox-runtime.log.v1",
        }),
      ),
    ).toEqual({
      type: "telemetry.open",
      streamId: 41,
      signal: "logs",
      format: "mistle.sandbox-runtime.log.v1",
    });

    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "telemetry.close",
          streamId: 41,
        }),
      ),
    ).toEqual({
      type: "telemetry.close",
      streamId: 41,
    });
  });

  it("rejects gateway-only telemetry control messages from bootstrap parsing", () => {
    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "telemetry.open.ok",
          streamId: 41,
          initialWindowBytes: 65536,
        }),
      ),
    ).toBeUndefined();
  });

  it("parses bootstrap keepalive state messages", () => {
    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "keepalive.state",
          ttlMs: 30_000,
          active: true,
        }),
      ),
    ).toEqual({
      type: "keepalive.state",
      ttlMs: 30_000,
      active: true,
    });
  });

  it("keeps stream and bootstrap control parsers scoped correctly", () => {
    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "keepalive.state",
          ttlMs: 30_000,
          active: false,
        }),
      ),
    ).toEqual({
      type: "keepalive.state",
      ttlMs: 30_000,
      active: false,
    });

    expect(
      parseStreamControlMessage(
        JSON.stringify({
          type: "keepalive.state",
          ttlMs: 30_000,
          active: false,
        }),
      ),
    ).toBeUndefined();

    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "stream.complete",
          streamId: 17,
        }),
      ),
    ).toEqual({
      type: "stream.complete",
      streamId: 17,
    });

    expect(
      parseBootstrapControlMessage(
        JSON.stringify({
          type: "stream.open",
          streamId: 17,
          channel: {
            kind: "agent",
          },
        }),
      ),
    ).toBeUndefined();
  });
});

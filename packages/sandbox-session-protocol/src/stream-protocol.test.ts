import { describe, expect, it } from "vitest";

import {
  parseBootstrapControlMessage,
  parseLeaseControlMessage,
  parseStreamControlMessage,
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

  it("parses execution lease control messages", () => {
    expect(
      parseLeaseControlMessage(
        JSON.stringify({
          type: "lease.create",
          lease: {
            id: "sxl_123",
            kind: "agent_execution",
            source: "codex",
            externalExecutionId: "turn_123",
            metadata: {
              threadId: "thr_123",
            },
          },
        }),
      ),
    ).toEqual({
      type: "lease.create",
      lease: {
        id: "sxl_123",
        kind: "agent_execution",
        source: "codex",
        externalExecutionId: "turn_123",
        metadata: {
          threadId: "thr_123",
        },
      },
    });

    expect(
      parseLeaseControlMessage(
        JSON.stringify({
          type: "lease.renew",
          leaseId: "sxl_123",
        }),
      ),
    ).toEqual({
      type: "lease.renew",
      leaseId: "sxl_123",
    });
  });

  it("keeps stream and bootstrap control parsers scoped correctly", () => {
    const leaseCreatePayload = JSON.stringify({
      type: "lease.create",
      lease: {
        id: "sxl_123",
        kind: "agent_execution",
        source: "codex",
      },
    });

    expect(parseStreamControlMessage(leaseCreatePayload)).toBeUndefined();
    expect(parseBootstrapControlMessage(leaseCreatePayload)).toEqual({
      type: "lease.create",
      lease: {
        id: "sxl_123",
        kind: "agent_execution",
        source: "codex",
      },
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

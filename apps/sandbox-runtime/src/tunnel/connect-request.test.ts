import { describe, expect, it } from "vitest";

import {
  parseConnectRequestMessage,
  parseFileUploadConnectRequest,
  parsePtyConnectRequest,
  parsePtyResizeSignal,
  parseStreamCloseMessage,
} from "./connect-request.js";

describe("parseConnectRequestMessage", () => {
  it("parses a text stream.open envelope", () => {
    expect(
      parseConnectRequestMessage({
        kind: "text",
        payload: JSON.stringify({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        }),
      }),
    ).toEqual({
      type: "stream.open",
      streamId: 1,
      channelKind: "agent",
      rawPayload: '{"type":"stream.open","streamId":1,"channel":{"kind":"agent"}}',
    });
  });

  it("rejects binary connect requests", () => {
    expect(() =>
      parseConnectRequestMessage({
        kind: "binary",
        payload: new Uint8Array(),
      }),
    ).toThrow("expected connect request websocket text message, got binary");
  });
});

describe("pty control message parsing", () => {
  it("parses a pty connect request", () => {
    expect(
      parsePtyConnectRequest(
        JSON.stringify({
          type: "stream.open",
          streamId: 7,
          channel: {
            kind: "pty",
            session: "create",
            ptySessionId: "terminal",
            cols: 80,
            rows: 24,
          },
        }),
      ),
    ).toEqual({
      type: "stream.open",
      streamId: 7,
      channel: {
        kind: "pty",
        session: "create",
        ptySessionId: "terminal",
        cols: 80,
        rows: 24,
      },
    });
  });

  it("parses a pty connect request with an explicit startup command", () => {
    expect(
      parsePtyConnectRequest(
        JSON.stringify({
          type: "stream.open",
          streamId: 8,
          channel: {
            kind: "pty",
            session: "create",
            ptySessionId: "cli",
            cols: 80,
            rows: 24,
            command: "codex",
            args: ["resume", "--remote", "ws://127.0.0.1:4500", "thread_123"],
          },
        }),
      ),
    ).toEqual({
      type: "stream.open",
      streamId: 8,
      channel: {
        kind: "pty",
        session: "create",
        ptySessionId: "cli",
        cols: 80,
        rows: 24,
        command: "codex",
        args: ["resume", "--remote", "ws://127.0.0.1:4500", "thread_123"],
      },
    });
  });

  it("rejects invalid pty session selection and mismatched dimensions", () => {
    expect(() =>
      parsePtyConnectRequest(
        JSON.stringify({
          type: "stream.open",
          streamId: 7,
          channel: {
            kind: "pty",
            session: "resume",
            ptySessionId: "terminal",
            cols: 80,
            rows: 24,
          },
        }),
      ),
    ).toThrow("invalid_pty_session_mode 'resume'");

    expect(() =>
      parsePtyConnectRequest(
        JSON.stringify({
          type: "stream.open",
          streamId: 7,
          channel: {
            kind: "pty",
            session: "create",
            ptySessionId: "terminal",
            cols: 80,
          },
        }),
      ),
    ).toThrow("pty stream.open request cols and rows must both be provided when either is set");

    expect(() =>
      parsePtyConnectRequest(
        JSON.stringify({
          type: "stream.open",
          streamId: 7,
          channel: {
            kind: "pty",
            session: "create",
            ptySessionId: "terminal",
            cols: 80,
            rows: 24,
            command: "codex",
            args: ["resume", ""],
          },
        }),
      ),
    ).toThrow("pty stream.open request args must contain only non-empty strings");

    expect(() =>
      parsePtyConnectRequest(
        JSON.stringify({
          type: "stream.open",
          streamId: 7,
          channel: {
            kind: "pty",
            session: "create",
            ptySessionId: "terminal",
            cols: 80,
            rows: 24,
            command: 42,
          },
        }),
      ),
    ).toThrow("pty stream.open request command must be a non-empty string");

    expect(() =>
      parsePtyConnectRequest(
        JSON.stringify({
          type: "stream.open",
          streamId: 7,
          channel: {
            kind: "pty",
            session: "create",
            ptySessionId: "terminal",
            cols: 80,
            rows: 24,
            command: "   ",
          },
        }),
      ),
    ).toThrow("pty stream.open request command must be a non-empty string");

    expect(() =>
      parsePtyConnectRequest(
        JSON.stringify({
          type: "stream.open",
          streamId: 7,
          channel: {
            kind: "pty",
            session: "create",
            ptySessionId: "terminal",
            cols: 80,
            rows: 24,
            command: "codex",
            args: "resume",
          },
        }),
      ),
    ).toThrow("pty stream.open request args must be an array of non-empty strings");
  });

  it("parses pty resize and close messages", () => {
    expect(
      parsePtyResizeSignal(
        JSON.stringify({
          type: "stream.signal",
          streamId: 7,
          signal: {
            type: "pty.resize",
            cols: 100,
            rows: 40,
          },
        }),
      ),
    ).toEqual({
      type: "stream.signal",
      streamId: 7,
      signal: {
        type: "pty.resize",
        cols: 100,
        rows: 40,
      },
    });

    expect(
      parseStreamCloseMessage(
        JSON.stringify({
          type: "stream.close",
          streamId: 7,
        }),
      ),
    ).toEqual({
      type: "stream.close",
      streamId: 7,
    });
  });

  it("rejects invalid pty resize dimensions", () => {
    expect(() =>
      parsePtyResizeSignal(
        JSON.stringify({
          type: "stream.signal",
          streamId: 7,
          signal: {
            type: "pty.resize",
            cols: 0,
            rows: 40,
          },
        }),
      ),
    ).toThrow("pty resize signal cols and rows must be greater than or equal to 1");
  });
});

describe("file upload control message parsing", () => {
  it("parses a file upload connect request", () => {
    expect(
      parseFileUploadConnectRequest(
        JSON.stringify({
          type: "stream.open",
          streamId: 9,
          channel: {
            kind: "fileUpload",
            threadId: "thread_123",
            mimeType: "image/png",
            originalFilename: "screenshot.png",
            sizeBytes: 512,
          },
        }),
      ),
    ).toEqual({
      type: "stream.open",
      streamId: 9,
      channel: {
        kind: "fileUpload",
        threadId: "thread_123",
        mimeType: "image/png",
        originalFilename: "screenshot.png",
        sizeBytes: 512,
      },
    });
  });

  it("rejects malformed file upload connect requests", () => {
    expect(() =>
      parseFileUploadConnectRequest(
        JSON.stringify({
          type: "stream.open",
          streamId: 9,
          channel: {
            kind: "fileUpload",
            threadId: "thread_123",
            mimeType: "image/png",
            originalFilename: "screenshot.png",
          },
        }),
      ),
    ).toThrow("file upload stream.open request must declare a valid fileUpload channel");
  });
});

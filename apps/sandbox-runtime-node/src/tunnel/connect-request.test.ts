import { describe, expect, it } from "vitest";

import {
  parseConnectRequestMessage,
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
        cols: 80,
        rows: 24,
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
            cols: 80,
          },
        }),
      ),
    ).toThrow("pty stream.open request cols and rows must both be provided when either is set");
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

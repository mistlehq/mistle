import { describe, expect, it } from "vitest";

import {
  DataFrameKindData,
  DataFrameHeaderByteLength,
  PayloadKindRawBytes,
  PayloadKindWebSocketBinary,
  PayloadKindWebSocketText,
  decodeDataFrame,
  encodeDataFrame,
} from "./data-frame.js";

describe("data frame codec", () => {
  it("round-trips a PTY payload", () => {
    const encoded = encodeDataFrame({
      streamId: 17,
      payloadKind: PayloadKindRawBytes,
      payload: new Uint8Array([104, 101, 108, 108, 111]),
    });

    const decoded = decodeDataFrame(encoded);

    expect(decoded).toEqual({
      frameKind: DataFrameKindData,
      streamId: 17,
      payloadKind: PayloadKindRawBytes,
      payload: new Uint8Array([104, 101, 108, 108, 111]),
    });
  });

  it("round-trips websocket text payloads", () => {
    const encoded = encodeDataFrame({
      streamId: 8,
      payloadKind: PayloadKindWebSocketText,
      payload: new TextEncoder().encode('{"jsonrpc":"2.0"}'),
    });

    const decoded = decodeDataFrame(encoded);

    expect(decoded.streamId).toBe(8);
    expect(decoded.payloadKind).toBe(PayloadKindWebSocketText);
    expect(new TextDecoder().decode(decoded.payload)).toBe('{"jsonrpc":"2.0"}');
  });

  it("round-trips websocket binary payloads", () => {
    const encoded = encodeDataFrame({
      streamId: 9,
      payloadKind: PayloadKindWebSocketBinary,
      payload: new Uint8Array([0, 255, 127]),
    });

    const decoded = decodeDataFrame(encoded);

    expect(decoded.streamId).toBe(9);
    expect(decoded.payloadKind).toBe(PayloadKindWebSocketBinary);
    expect(Array.from(decoded.payload)).toEqual([0, 255, 127]);
  });

  it("rejects frames shorter than the fixed header", () => {
    expect(() => decodeDataFrame(new Uint8Array(DataFrameHeaderByteLength - 1))).toThrow(
      `data frame must be at least ${String(DataFrameHeaderByteLength)} bytes long`,
    );
  });

  it("rejects unsupported frame kinds", () => {
    const encoded = new Uint8Array(DataFrameHeaderByteLength);
    const view = new DataView(encoded.buffer);
    view.setUint8(0, 0x02);
    view.setUint32(1, 1);
    view.setUint8(5, PayloadKindRawBytes);

    expect(() => decodeDataFrame(encoded)).toThrow("frameKind is not supported: 2");
  });

  it("rejects invalid stream ids during encoding", () => {
    expect(() =>
      encodeDataFrame({
        streamId: 0,
        payloadKind: PayloadKindRawBytes,
        payload: new Uint8Array(),
      }),
    ).toThrow("streamId must be an integer between 1 and 4294967295");
  });

  it("rejects unsupported payload kinds during decoding", () => {
    const encoded = new Uint8Array(DataFrameHeaderByteLength);
    const view = new DataView(encoded.buffer);
    view.setUint8(0, DataFrameKindData);
    view.setUint32(1, 1);
    view.setUint8(5, 0x09);

    expect(() => decodeDataFrame(encoded)).toThrow("payloadKind is not supported: 9");
  });
});

import {
  DataFrameKindData,
  MaxStreamId,
  PayloadKindRawBytes,
  PayloadKindWebSocketBinary,
  encodeDataFrame,
} from "@mistle/sandbox-session-protocol";
import { describe, expect, it } from "vitest";

import { FrameCodec } from "./frame-codec.js";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

describe("FrameCodec", () => {
  it("reads the header from a valid tunnel data frame", () => {
    const codec = new FrameCodec();
    const payload = toArrayBuffer(
      encodeDataFrame({
        streamId: 42,
        payloadKind: PayloadKindWebSocketBinary,
        payload: new Uint8Array([1, 2, 3]),
      }),
    );

    expect(codec.readDataFrameHeader(payload)).toEqual({
      payloadKind: PayloadKindWebSocketBinary,
      streamId: 42,
    });
  });

  it("rewrites the stream id while preserving the rest of the frame", () => {
    const codec = new FrameCodec();
    const originalPayload = toArrayBuffer(
      encodeDataFrame({
        streamId: 41,
        payloadKind: PayloadKindRawBytes,
        payload: new Uint8Array([9, 8, 7, 6]),
      }),
    );

    const rewrittenPayload = codec.rewriteStreamId({
      payload: originalPayload,
      streamId: 99,
    });
    if (rewrittenPayload === undefined) {
      throw new Error("Expected valid frame rewrite to produce a payload.");
    }

    expect(codec.readDataFrameHeader(rewrittenPayload)).toEqual({
      payloadKind: PayloadKindRawBytes,
      streamId: 99,
    });

    const originalBytes = new Uint8Array(originalPayload);
    const rewrittenBytes = new Uint8Array(rewrittenPayload);
    expect(rewrittenBytes[0]).toBe(DataFrameKindData);
    expect(rewrittenBytes.slice(5)).toEqual(originalBytes.slice(5));
  });

  it("rejects malformed frames and invalid target stream ids", () => {
    const codec = new FrameCodec();
    const invalidFrame = new Uint8Array([DataFrameKindData, 0, 0, 0, 0, PayloadKindRawBytes]);

    expect(codec.readDataFrameHeader(invalidFrame.buffer)).toBeUndefined();
    expect(
      codec.rewriteStreamId({
        payload: toArrayBuffer(
          encodeDataFrame({
            streamId: 1,
            payloadKind: PayloadKindRawBytes,
            payload: new Uint8Array([1]),
          }),
        ),
        streamId: 0,
      }),
    ).toBeUndefined();
    expect(
      codec.rewriteStreamId({
        payload: invalidFrame.buffer,
        streamId: MaxStreamId + 1,
      }),
    ).toBeUndefined();
  });
});

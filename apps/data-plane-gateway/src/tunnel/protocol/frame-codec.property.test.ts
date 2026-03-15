/* eslint-disable jest/no-standalone-expect --
 * `@fast-check/vitest` property callbacks are test bodies, but the lint rule does not detect them.
 */

import { test as propertyTest, fc } from "@fast-check/vitest";
import {
  PayloadKindRawBytes,
  PayloadKindWebSocketBinary,
  PayloadKindWebSocketText,
  encodeDataFrame,
} from "@mistle/sandbox-session-protocol";
import { expect } from "vitest";

import { FrameCodec } from "./frame-codec.js";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

propertyTest.prop(
  [
    fc.integer({ min: 1, max: 0xffff_ffff }),
    fc.integer({ min: 1, max: 0xffff_ffff }),
    fc.constantFrom(PayloadKindRawBytes, PayloadKindWebSocketText, PayloadKindWebSocketBinary),
    fc.uint8Array({ maxLength: 64 }),
  ],
  { numRuns: 100 },
)(
  "rewriting a valid frame preserves payload bytes and updates only the stream id",
  (originalStreamId, rewrittenStreamId, payloadKind, payload) => {
    const codec = new FrameCodec();
    const encoded = toArrayBuffer(
      encodeDataFrame({
        streamId: originalStreamId,
        payloadKind,
        payload,
      }),
    );

    const rewritten = codec.rewriteStreamId({
      payload: encoded,
      streamId: rewrittenStreamId,
    });
    if (rewritten === undefined) {
      throw new Error("Expected valid frame rewrite to produce a payload.");
    }

    expect(codec.readDataFrameHeader(rewritten)).toEqual({
      payloadKind,
      streamId: rewrittenStreamId,
    });
    expect(new Uint8Array(rewritten).slice(5)).toEqual(new Uint8Array(encoded).slice(5));
  },
);

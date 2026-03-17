import { encodeDataFrame, PayloadKindRawBytes } from "@mistle/sandbox-session-protocol";
import { describe, expect, it } from "vitest";

import { parseTunnelMessageRouting } from "./tunnel-message.js";

describe("parseTunnelMessageRouting", () => {
  it("routes text control messages by stream id", () => {
    expect(
      parseTunnelMessageRouting({
        kind: "text",
        payload: JSON.stringify({
          type: "stream.close",
          streamId: 9,
        }),
      }),
    ).toEqual({
      controlMessageType: "stream.close",
      streamId: 9,
    });
  });

  it("routes binary data frames by stream id", () => {
    const dataFrame = encodeDataFrame({
      streamId: 11,
      payloadKind: PayloadKindRawBytes,
      payload: new Uint8Array([1, 2, 3]),
    });

    expect(parseTunnelMessageRouting({ kind: "binary", payload: dataFrame }).streamId).toBe(11);
  });
});

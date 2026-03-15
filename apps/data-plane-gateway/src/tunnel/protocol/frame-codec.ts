import {
  DataFrameHeaderByteLength,
  DataFrameKindData,
  MaxStreamId,
  PayloadKindRawBytes,
  PayloadKindWebSocketBinary,
  PayloadKindWebSocketText,
} from "@mistle/sandbox-session-protocol";

export type TunnelDataFrameHeader = {
  payloadKind: number;
  streamId: number;
};

function isSupportedDataFramePayloadKind(payloadKind: number): boolean {
  return (
    payloadKind === PayloadKindRawBytes ||
    payloadKind === PayloadKindWebSocketText ||
    payloadKind === PayloadKindWebSocketBinary
  );
}

/**
 * Encodes and decodes the tunnel's binary data-frame header without owning any routing policy.
 */
export class FrameCodec {
  /**
   * Reads the tunnel data-frame header and returns `undefined` when the payload is malformed.
   */
  public readDataFrameHeader(payload: ArrayBuffer): TunnelDataFrameHeader | undefined {
    const view = new DataView(payload);
    if (view.byteLength < DataFrameHeaderByteLength) {
      return undefined;
    }

    if (view.getUint8(0) !== DataFrameKindData) {
      return undefined;
    }

    const streamId = view.getUint32(1);
    if (streamId === 0 || streamId > MaxStreamId) {
      return undefined;
    }

    const payloadKind = view.getUint8(5);
    if (!isSupportedDataFramePayloadKind(payloadKind)) {
      return undefined;
    }

    return {
      payloadKind,
      streamId,
    };
  }

  /**
   * Rewrites the stream id of a valid tunnel data frame and returns `undefined` for invalid input.
   */
  public rewriteStreamId(input: {
    payload: ArrayBuffer;
    streamId: number;
  }): ArrayBuffer | undefined {
    if (!Number.isInteger(input.streamId) || input.streamId <= 0 || input.streamId > MaxStreamId) {
      return undefined;
    }

    const dataFrameHeader = this.readDataFrameHeader(input.payload);
    if (dataFrameHeader === undefined) {
      return undefined;
    }

    const rewrittenPayload = input.payload.slice(0);
    new DataView(rewrittenPayload).setUint32(1, input.streamId);
    return rewrittenPayload;
  }
}

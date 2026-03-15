export const DataFrameHeaderByteLength = 6;
export const DataFrameKindData = 0x01;
export const PayloadKindRawBytes = 0x01;
export const PayloadKindWebSocketText = 0x02;
export const PayloadKindWebSocketBinary = 0x03;
export const MaxStreamId = 0xffff_ffff;
export const DefaultStreamWindowBytes = 64 * 1024;
export const MaxStreamWindowBytes = DefaultStreamWindowBytes;

export interface StreamDataFrame {
  frameKind: number;
  streamId: number;
  payloadKind: number;
  payload: Uint8Array;
}

function validateStreamId(streamId: number): void {
  if (!Number.isInteger(streamId) || streamId <= 0 || streamId > MaxStreamId) {
    throw new Error(`streamId must be an integer between 1 and ${String(MaxStreamId)}`);
  }
}

function validatePayloadKind(payloadKind: number): void {
  if (
    payloadKind !== PayloadKindRawBytes &&
    payloadKind !== PayloadKindWebSocketText &&
    payloadKind !== PayloadKindWebSocketBinary
  ) {
    throw new Error(`payloadKind is not supported: ${String(payloadKind)}`);
  }
}

export function encodeDataFrame(input: {
  streamId: number;
  payloadKind: number;
  payload: Uint8Array;
}): Uint8Array {
  validateStreamId(input.streamId);
  validatePayloadKind(input.payloadKind);

  const encoded = new Uint8Array(DataFrameHeaderByteLength + input.payload.byteLength);
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);

  view.setUint8(0, DataFrameKindData);
  view.setUint32(1, input.streamId);
  view.setUint8(5, input.payloadKind);
  encoded.set(input.payload, DataFrameHeaderByteLength);

  return encoded;
}

export function decodeDataFrame(encoded: Uint8Array): StreamDataFrame {
  if (encoded.byteLength < DataFrameHeaderByteLength) {
    throw new Error(`data frame must be at least ${String(DataFrameHeaderByteLength)} bytes long`);
  }

  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  const frameKind = view.getUint8(0);
  if (frameKind !== DataFrameKindData) {
    throw new Error(`frameKind is not supported: ${String(frameKind)}`);
  }

  const streamId = view.getUint32(1);
  validateStreamId(streamId);

  const payloadKind = view.getUint8(5);
  validatePayloadKind(payloadKind);

  return {
    frameKind,
    streamId,
    payloadKind,
    payload: encoded.slice(DataFrameHeaderByteLength),
  };
}

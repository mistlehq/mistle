export type ActiveHttpPublishStream = {
  close: (cause?: Error) => void;
  endRequestBody: () => void;
  streamId: number;
  writeRequestChunk: (bytes: Uint8Array) => Promise<void>;
};

export type ActiveWsPublishStream = {
  close: () => void;
  sendRequestClose: (input: { code?: number; reason?: string }) => void;
  sendRequestFrame: (input: { bytes: Uint8Array; opcode: "binary" | "text" }) => void;
  streamId: number;
};

export type PublishStreamState = {
  httpStreamsById: Map<number, ActiveHttpPublishStream>;
  wsStreamsById: Map<number, ActiveWsPublishStream>;
};

export function createPublishStreamState(): PublishStreamState {
  return {
    httpStreamsById: new Map<number, ActiveHttpPublishStream>(),
    wsStreamsById: new Map<number, ActiveWsPublishStream>(),
  };
}

export function closeAllPublishStreams(input: { state: PublishStreamState }): void {
  for (const stream of input.state.httpStreamsById.values()) {
    stream.close();
  }
  for (const stream of input.state.wsStreamsById.values()) {
    stream.close();
  }

  input.state.httpStreamsById.clear();
  input.state.wsStreamsById.clear();
}

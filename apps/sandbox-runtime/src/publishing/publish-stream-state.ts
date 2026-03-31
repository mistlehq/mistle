export type ActiveHttpPublishStream = {
  close: (cause?: Error) => void;
  endRequestBody: () => void;
  streamId: number;
  writeRequestChunk: (bytes: Uint8Array) => Promise<void>;
};

export type PublishStreamState = {
  httpStreamsById: Map<number, ActiveHttpPublishStream>;
};

export function createPublishStreamState(): PublishStreamState {
  return {
    httpStreamsById: new Map<number, ActiveHttpPublishStream>(),
  };
}

export function closeAllPublishStreams(input: { state: PublishStreamState }): void {
  for (const stream of input.state.httpStreamsById.values()) {
    stream.close();
  }

  input.state.httpStreamsById.clear();
}

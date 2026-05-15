import type {
  OperationOpenError,
  OperationOpenOK,
  OperationReset,
  OperationWindow,
} from "@mistle/sandbox-session-protocol";

export function createOperationOpenOk(input: {
  initialWindowBytes: number;
  streamId: number;
}): OperationOpenOK {
  return {
    type: "operation.open.ok",
    streamId: input.streamId,
    initialWindowBytes: input.initialWindowBytes,
  };
}

export function createOperationOpenError(input: {
  code: string;
  message: string;
  streamId: number;
}): OperationOpenError {
  return {
    type: "operation.open.error",
    streamId: input.streamId,
    code: input.code,
    message: input.message,
  };
}

export function createOperationReset(input: {
  code: string;
  message: string;
  streamId: number;
}): OperationReset {
  return {
    type: "operation.reset",
    streamId: input.streamId,
    code: input.code,
    message: input.message,
  };
}

export function createOperationWindow(input: { bytes: number; streamId: number }): OperationWindow {
  return {
    type: "operation.window",
    streamId: input.streamId,
    bytes: input.bytes,
  };
}

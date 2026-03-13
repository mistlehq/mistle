export interface AgentStreamChannel {
  kind: "agent";
}

export interface PTYStreamChannel {
  kind: "pty";
  session: "create" | "attach";
  cols?: number;
  rows?: number;
  cwd?: string;
}

export type StreamChannel = AgentStreamChannel | PTYStreamChannel;

export interface PTYResizeSignal {
  type: "pty.resize";
  cols: number;
  rows: number;
}

export type StreamSignal = PTYResizeSignal;

export interface PTYExitEvent {
  type: "pty.exit";
  exitCode: number;
}

export type StreamEvent = PTYExitEvent;

export interface StreamOpen {
  type: "stream.open";
  streamId: number;
  channel: StreamChannel;
}

export interface StreamOpenOK {
  type: "stream.open.ok";
  streamId: number;
}

export interface StreamOpenError {
  type: "stream.open.error";
  streamId: number;
  code: string;
  message: string;
}

export interface StreamSignalMessage {
  type: "stream.signal";
  streamId: number;
  signal: StreamSignal;
}

export interface StreamEventMessage {
  type: "stream.event";
  streamId: number;
  event: StreamEvent;
}

export interface StreamClose {
  type: "stream.close";
  streamId: number;
}

export interface StreamReset {
  type: "stream.reset";
  streamId: number;
  code: string;
  message: string;
}

export interface StreamWindow {
  type: "stream.window";
  streamId: number;
  bytes: number;
}

export type StreamControlMessage =
  | StreamOpen
  | StreamOpenOK
  | StreamOpenError
  | StreamSignalMessage
  | StreamEventMessage
  | StreamClose
  | StreamReset
  | StreamWindow;

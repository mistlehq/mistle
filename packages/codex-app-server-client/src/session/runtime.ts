export const CodexSessionSocketReadyStates = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export type CodexSessionSocketReadyState =
  (typeof CodexSessionSocketReadyStates)[keyof typeof CodexSessionSocketReadyStates];

export type CodexSessionSocketMessageEvent = unknown;

export type CodexSessionSocketEventMap = {
  open: (event: unknown) => void;
  message: (event: CodexSessionSocketMessageEvent) => void;
  error: (event: unknown) => void;
  close: (event: unknown) => void;
};

export type CodexSessionSocketEventName = keyof CodexSessionSocketEventMap;

export interface CodexSessionSocket {
  readonly readyState: CodexSessionSocketReadyState;
  addEventListener<EventName extends CodexSessionSocketEventName>(
    eventName: EventName,
    listener: CodexSessionSocketEventMap[EventName],
  ): void;
  removeEventListener<EventName extends CodexSessionSocketEventName>(
    eventName: EventName,
    listener: CodexSessionSocketEventMap[EventName],
  ): void;
  send(payload: string): void;
  close(code?: number, reason?: string): void;
}

export interface CodexScheduledTask {
  cancel(): void;
}

export interface CodexSessionRuntime {
  createSocket(connectionUrl: string): CodexSessionSocket;
  createStreamId(): number;
  scheduleTimeout(callback: () => void, timeoutMs: number): CodexScheduledTask;
}

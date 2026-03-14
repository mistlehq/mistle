export const SandboxSessionSocketReadyStates = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export type SandboxSessionSocketReadyState =
  (typeof SandboxSessionSocketReadyStates)[keyof typeof SandboxSessionSocketReadyStates];

export type SandboxSessionSocketMessageEvent = unknown;

export type SandboxSessionSocketEventMap = {
  open: (event: unknown) => void;
  message: (event: SandboxSessionSocketMessageEvent) => void;
  error: (event: unknown) => void;
  close: (event: unknown) => void;
};

export type SandboxSessionSocketEventName = keyof SandboxSessionSocketEventMap;

export interface SandboxSessionSocket {
  readonly readyState: SandboxSessionSocketReadyState;
  addEventListener<EventName extends SandboxSessionSocketEventName>(
    eventName: EventName,
    listener: SandboxSessionSocketEventMap[EventName],
  ): void;
  removeEventListener<EventName extends SandboxSessionSocketEventName>(
    eventName: EventName,
    listener: SandboxSessionSocketEventMap[EventName],
  ): void;
  send(payload: ArrayBuffer | Uint8Array | string): void;
  close(code?: number, reason?: string): void;
}

export interface SandboxScheduledTask {
  cancel(): void;
}

export interface SandboxSessionRuntime {
  createSocket(connectionUrl: string): SandboxSessionSocket;
  createStreamId(): number;
  scheduleTimeout(callback: () => void, timeoutMs: number): SandboxScheduledTask;
}

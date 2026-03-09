export const SandboxAgentSocketReadyStates = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export type SandboxAgentSocketReadyState =
  (typeof SandboxAgentSocketReadyStates)[keyof typeof SandboxAgentSocketReadyStates];

export type SandboxAgentSocketMessageEvent = unknown;

export type SandboxAgentSocketEventMap = {
  open: (event: unknown) => void;
  message: (event: SandboxAgentSocketMessageEvent) => void;
  error: (event: unknown) => void;
  close: (event: unknown) => void;
};

export type SandboxAgentSocketEventName = keyof SandboxAgentSocketEventMap;

export interface SandboxAgentSocket {
  readonly readyState: SandboxAgentSocketReadyState;
  addEventListener<EventName extends SandboxAgentSocketEventName>(
    eventName: EventName,
    listener: SandboxAgentSocketEventMap[EventName],
  ): void;
  removeEventListener<EventName extends SandboxAgentSocketEventName>(
    eventName: EventName,
    listener: SandboxAgentSocketEventMap[EventName],
  ): void;
  send(payload: string): void;
  close(code?: number, reason?: string): void;
}

export interface SandboxAgentScheduledTask {
  cancel(): void;
}

export interface SandboxAgentRuntime {
  createSocket(connectionUrl: string): SandboxAgentSocket;
  createRequestId(): string;
  scheduleTimeout(callback: () => void, timeoutMs: number): SandboxAgentScheduledTask;
}

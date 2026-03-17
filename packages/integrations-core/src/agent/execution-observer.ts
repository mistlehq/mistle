import type { AgentExecutionObservation } from "./types.js";

export type AgentExecutionObserverSession = {
  onOutboundMessage(message: Uint8Array | string): void;
  onInboundMessage(message: Uint8Array | string): void;
  drainObservations(): ReadonlyArray<AgentExecutionObservation>;
};

export type AgentExecutionObserverSessionInput = {
  transportUrl: string;
};

export type AgentExecutionObserver = {
  createSession(input: AgentExecutionObserverSessionInput): AgentExecutionObserverSession;
};

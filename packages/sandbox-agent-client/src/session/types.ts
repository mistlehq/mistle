import type { ConnectError, ConnectOK } from "@mistle/sandbox-session-protocol";

export type SandboxAgentConnectionState =
  | "idle"
  | "connecting_socket"
  | "handshaking_agent"
  | "connected_socket"
  | "initializing"
  | "ready"
  | "closed"
  | "error";

export type SandboxAgentControlMessage = ConnectOK | ConnectError;

export type SandboxAgentJsonRpcId = number | string;

export type SandboxAgentJsonRpcSuccessResponse = {
  id: SandboxAgentJsonRpcId;
  result: unknown;
};

export type SandboxAgentJsonRpcErrorResponse = {
  id: SandboxAgentJsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type SandboxAgentJsonRpcNotification = {
  method: string;
  params?: unknown;
};

export type SandboxAgentJsonRpcServerRequest = {
  id: SandboxAgentJsonRpcId;
  method: string;
  params?: unknown;
};

export type SandboxAgentEvent =
  | {
      type: "connection_state_changed";
      state: SandboxAgentConnectionState;
      errorMessage: string | null;
    }
  | {
      type: "notification";
      notification: SandboxAgentJsonRpcNotification;
    }
  | {
      type: "server_request";
      request: SandboxAgentJsonRpcServerRequest;
    }
  | {
      type: "response";
      response: SandboxAgentJsonRpcSuccessResponse | SandboxAgentJsonRpcErrorResponse;
    }
  | {
      type: "unhandled_message";
      payload: unknown;
    };

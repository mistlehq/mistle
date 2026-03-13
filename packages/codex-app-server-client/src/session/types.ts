import type { StreamOpenError, StreamOpenOK } from "@mistle/sandbox-session-protocol";

export type CodexSessionConnectionState =
  | "idle"
  | "connecting_socket"
  | "opening_agent_stream"
  | "connected_socket"
  | "initializing"
  | "ready"
  | "closed"
  | "error";

export type CodexControlMessage = StreamOpenOK | StreamOpenError;

export type CodexJsonRpcId = number | string;

export type CodexJsonRpcSuccessResponse = {
  id: CodexJsonRpcId;
  result: unknown;
};

export type CodexJsonRpcErrorResponse = {
  id: CodexJsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type CodexJsonRpcNotification = {
  method: string;
  params?: unknown;
};

export type CodexJsonRpcServerRequest = {
  id: CodexJsonRpcId;
  method: string;
  params?: unknown;
};

export type CodexSessionEvent =
  | {
      type: "connection_state_changed";
      state: CodexSessionConnectionState;
      errorMessage: string | null;
    }
  | {
      type: "notification";
      notification: CodexJsonRpcNotification;
    }
  | {
      type: "server_request";
      request: CodexJsonRpcServerRequest;
    }
  | {
      type: "response";
      response: CodexJsonRpcSuccessResponse | CodexJsonRpcErrorResponse;
    }
  | {
      type: "unhandled_message";
      payload: unknown;
    };

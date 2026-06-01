import type { StreamOpenError, StreamOpenOK } from "@mistle/sandbox-session-protocol";

import type { GatewayServiceRestartCloseInfo } from "./transport.js";

export type SandboxSessionConnectionState =
  | "idle"
  | "connecting_socket"
  | "opening_agent_stream"
  | "connected_socket"
  | "initializing"
  | "ready"
  | "closed"
  | "error";

export type SandboxControlMessage = StreamOpenOK | StreamOpenError;

export type SandboxSessionResetInfo = {
  code: string;
  message: string;
};

export type JsonRpcId = number | string;

export type JsonRpcSuccessResponse = {
  id: JsonRpcId;
  result: unknown;
};

export type JsonRpcErrorResponse = {
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

export type JsonRpcServerRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type SandboxSessionEvent =
  | {
      type: "connection_state_changed";
      state: SandboxSessionConnectionState;
      errorMessage: string | null;
      gatewayServiceRestart?: GatewayServiceRestartCloseInfo;
    }
  | {
      type: "notification";
      notification: JsonRpcNotification;
    }
  | {
      type: "server_request";
      request: JsonRpcServerRequest;
    }
  | {
      type: "response";
      response: JsonRpcSuccessResponse | JsonRpcErrorResponse;
    }
  | {
      type: "stream_reset";
      resetInfo: SandboxSessionResetInfo;
    }
  | {
      type: "unhandled_message";
      payload: unknown;
    };

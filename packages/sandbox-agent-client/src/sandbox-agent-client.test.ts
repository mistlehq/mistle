import { describe, expect, it } from "vitest";

import {
  parseConnectControlMessage,
  parseJsonRpcErrorResponse,
  parseJsonRpcNotification,
  parseJsonRpcServerRequest,
  parseJsonRpcSuccessResponse,
} from "./index.js";

describe("sandbox agent client protocol parsers", () => {
  it("parses connect.ok control messages", () => {
    expect(
      parseConnectControlMessage(
        JSON.stringify({
          type: "connect.ok",
          requestId: "req_123",
        }),
      ),
    ).toEqual({
      type: "connect.ok",
      requestId: "req_123",
    });
  });

  it("parses connect.error control messages", () => {
    expect(
      parseConnectControlMessage(
        JSON.stringify({
          type: "connect.error",
          requestId: "req_123",
          code: "REJECTED",
          message: "agent connection rejected",
        }),
      ),
    ).toEqual({
      type: "connect.error",
      requestId: "req_123",
      code: "REJECTED",
      message: "agent connection rejected",
    });
  });

  it("ignores non-control payloads when parsing control messages", () => {
    expect(
      parseConnectControlMessage(
        JSON.stringify({
          method: "thread/start",
          id: 1,
        }),
      ),
    ).toBeNull();
  });

  it("parses JSON-RPC success responses", () => {
    expect(
      parseJsonRpcSuccessResponse({
        id: 7,
        result: {
          ok: true,
        },
      }),
    ).toEqual({
      id: 7,
      result: {
        ok: true,
      },
    });
  });

  it("parses JSON-RPC error responses", () => {
    expect(
      parseJsonRpcErrorResponse({
        id: 7,
        error: {
          code: -32603,
          message: "internal error",
        },
      }),
    ).toEqual({
      id: 7,
      error: {
        code: -32603,
        message: "internal error",
      },
    });
  });

  it("parses JSON-RPC notifications", () => {
    expect(
      parseJsonRpcNotification({
        method: "turn/completed",
        params: {
          turn: {
            id: "turn_123",
          },
        },
      }),
    ).toEqual({
      method: "turn/completed",
      params: {
        turn: {
          id: "turn_123",
        },
      },
    });
  });

  it("parses JSON-RPC server requests", () => {
    expect(
      parseJsonRpcServerRequest({
        id: 11,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thread_123",
        },
      }),
    ).toEqual({
      id: 11,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread_123",
      },
    });
  });
});

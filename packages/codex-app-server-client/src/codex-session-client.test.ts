import { describe, expect, it } from "vitest";

import {
  parseStreamOpenControlMessage,
  parseJsonRpcErrorResponse,
  parseJsonRpcNotification,
  parseJsonRpcServerRequest,
  parseJsonRpcSuccessResponse,
} from "./codex-session-client.js";

describe("codex app server client protocol parsers", () => {
  it("parses stream.open.ok control messages", () => {
    expect(
      parseStreamOpenControlMessage(
        JSON.stringify({
          type: "stream.open.ok",
          streamId: 17,
        }),
      ),
    ).toEqual({
      type: "stream.open.ok",
      streamId: 17,
    });
  });

  it("parses stream.open.error control messages", () => {
    expect(
      parseStreamOpenControlMessage(
        JSON.stringify({
          type: "stream.open.error",
          streamId: 17,
          code: "REJECTED",
          message: "agent connection rejected",
        }),
      ),
    ).toEqual({
      type: "stream.open.error",
      streamId: 17,
      code: "REJECTED",
      message: "agent connection rejected",
    });
  });

  it("ignores non-control payloads when parsing control messages", () => {
    expect(
      parseStreamOpenControlMessage(
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

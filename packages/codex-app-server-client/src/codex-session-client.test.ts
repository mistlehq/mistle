import {
  SandboxSessionClient,
  parseJsonRpcErrorResponse,
  parseJsonRpcNotification,
  parseJsonRpcServerRequest,
  parseJsonRpcSuccessResponse,
  parseStreamOpenControlMessage,
} from "@mistle/sandbox-session-client";
import { createNodeSandboxSessionRuntime } from "@mistle/sandbox-session-client/node";
import { describe, expect, it } from "vitest";

import {
  CodexSessionClient,
  parseJsonRpcErrorResponse as parseCodexJsonRpcErrorResponse,
  parseJsonRpcNotification as parseCodexJsonRpcNotification,
  parseJsonRpcServerRequest as parseCodexJsonRpcServerRequest,
  parseJsonRpcSuccessResponse as parseCodexJsonRpcSuccessResponse,
  parseStreamOpenControlMessage as parseCodexStreamOpenControlMessage,
} from "./index.js";
import { createNodeCodexSessionRuntime } from "./node.js";

describe("codex app server client compatibility", () => {
  it("re-exports the shared sandbox session client and parser helpers", () => {
    expect(CodexSessionClient).toBe(SandboxSessionClient);
    expect(parseCodexStreamOpenControlMessage).toBe(parseStreamOpenControlMessage);
    expect(parseCodexJsonRpcSuccessResponse).toBe(parseJsonRpcSuccessResponse);
    expect(parseCodexJsonRpcErrorResponse).toBe(parseJsonRpcErrorResponse);
    expect(parseCodexJsonRpcNotification).toBe(parseJsonRpcNotification);
    expect(parseCodexJsonRpcServerRequest).toBe(parseJsonRpcServerRequest);
  });

  it("re-exports the node runtime helper", () => {
    expect(createNodeCodexSessionRuntime).toBe(createNodeSandboxSessionRuntime);
  });
});

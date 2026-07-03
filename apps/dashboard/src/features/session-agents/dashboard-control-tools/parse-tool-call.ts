import type { CodexJsonRpcServerRequest } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { z } from "zod";

import type { DashboardControlActionRequest } from "./action-types.js";
import { DesignerCanvasTabShowDynamicToolCallSchema } from "./canvas-tab-tool.js";
import {
  CodexRuntimeMcpServersInstallAction,
  CodexRuntimeMcpServersInstallDynamicToolName,
  DashboardControlDynamicToolNamespace,
  DashboardControlDynamicToolRequestMethod,
  DesignerBlueprintTabUpsertAction,
  DesignerCanvasTabOpenAction,
  DesignerCanvasTabShowDynamicToolName,
  DesignerUserInputRequestAction,
  DesignerUserInputRequestDynamicToolName,
} from "./constants.js";
import {
  createDashboardControlDynamicToolCallResponse,
  type DashboardControlDynamicToolCallResponse,
} from "./responses.js";
import { CodexRuntimeMcpServersInstallDynamicToolCallSchema } from "./runtime-mcp-servers-install-tool.js";
import { DesignerUserInputRequestDynamicToolCallSchema } from "./user-input-tool.js";

const DashboardControlDynamicToolCallIdentitySchema = z
  .object({
    namespace: z.string().nullable().optional(),
    tool: z.string().optional(),
  })
  .loose();

export function isDashboardControlDynamicToolCallRequest(
  request: CodexJsonRpcServerRequest,
): request is CodexJsonRpcServerRequest & {
  method: typeof DashboardControlDynamicToolRequestMethod;
} {
  if (request.method !== DashboardControlDynamicToolRequestMethod) {
    return false;
  }

  const identity = DashboardControlDynamicToolCallIdentitySchema.safeParse(request.params);
  return (
    identity.success &&
    identity.data.namespace === DashboardControlDynamicToolNamespace &&
    isKnownDashboardControlDynamicToolName(identity.data.tool)
  );
}

export function parseDashboardControlDynamicToolCall(
  params: unknown,
): DashboardControlActionRequest | DashboardControlDynamicToolCallResponse {
  const parsedCanvasTabRequest = DesignerCanvasTabShowDynamicToolCallSchema.safeParse(params);
  if (parsedCanvasTabRequest.success) {
    const requestedTab = parsedCanvasTabRequest.data.arguments.tab;
    if (requestedTab.kind === "route") {
      return {
        action: DesignerCanvasTabOpenAction,
        input: requestedTab,
      };
    }

    return {
      action: DesignerBlueprintTabUpsertAction,
      input: requestedTab,
    };
  }

  const parsedUserInputRequest = DesignerUserInputRequestDynamicToolCallSchema.safeParse(params);
  if (parsedUserInputRequest.success) {
    return {
      action: DesignerUserInputRequestAction,
      input: parsedUserInputRequest.data.arguments,
    };
  }

  const parsedRuntimeMcpInstallRequest =
    CodexRuntimeMcpServersInstallDynamicToolCallSchema.safeParse(params);
  if (parsedRuntimeMcpInstallRequest.success) {
    return {
      action: CodexRuntimeMcpServersInstallAction,
      input: parsedRuntimeMcpInstallRequest.data.arguments,
    };
  }

  const identity = DashboardControlDynamicToolCallIdentitySchema.safeParse(params);
  if (
    identity.success &&
    identity.data.namespace === DashboardControlDynamicToolNamespace &&
    identity.data.tool === DesignerCanvasTabShowDynamicToolName
  ) {
    return createDashboardControlDynamicToolCallResponse({
      success: false,
      text: "Designer canvas tab input is invalid.",
    });
  }

  if (
    identity.success &&
    identity.data.namespace === DashboardControlDynamicToolNamespace &&
    identity.data.tool === DesignerUserInputRequestDynamicToolName
  ) {
    return createDashboardControlDynamicToolCallResponse({
      success: false,
      text: "Designer user input request is invalid.",
    });
  }

  if (
    identity.success &&
    identity.data.namespace === DashboardControlDynamicToolNamespace &&
    identity.data.tool === CodexRuntimeMcpServersInstallDynamicToolName
  ) {
    return createDashboardControlDynamicToolCallResponse({
      success: false,
      text: "Runtime MCP install input is invalid.",
    });
  }

  return createDashboardControlDynamicToolCallResponse({
    success: false,
    text: "Dashboard control action input is invalid.",
  });
}

function isKnownDashboardControlDynamicToolName(toolName: string | undefined): boolean {
  return (
    toolName === DesignerCanvasTabShowDynamicToolName ||
    toolName === DesignerUserInputRequestDynamicToolName ||
    toolName === CodexRuntimeMcpServersInstallDynamicToolName
  );
}

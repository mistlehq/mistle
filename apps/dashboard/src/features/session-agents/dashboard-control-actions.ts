import type { CodexDynamicToolSpec } from "@mistle/integrations-definitions/agent-runtimes/codex/client";

import { DesignerCanvasTabShowDynamicToolSpec } from "./dashboard-control-tools/canvas-tab-tool.js";
import { CodexRuntimeMcpServersInstallDynamicToolSpec } from "./dashboard-control-tools/runtime-mcp-servers-install-tool.js";
import { DesignerUserInputRequestDynamicToolSpec } from "./dashboard-control-tools/user-input-tool.js";

export * from "./dashboard-control-tools/action-types.js";
export * from "./dashboard-control-tools/canvas-tab-tool.js";
export * from "./dashboard-control-tools/constants.js";
export * from "./dashboard-control-tools/parse-tool-call.js";
export * from "./dashboard-control-tools/responses.js";
export * from "./dashboard-control-tools/runtime-mcp-servers-install-tool.js";
export * from "./dashboard-control-tools/user-input-tool.js";

export const DashboardControlDynamicToolSpecs = [
  DesignerCanvasTabShowDynamicToolSpec,
  DesignerUserInputRequestDynamicToolSpec,
  CodexRuntimeMcpServersInstallDynamicToolSpec,
] satisfies readonly CodexDynamicToolSpec[];

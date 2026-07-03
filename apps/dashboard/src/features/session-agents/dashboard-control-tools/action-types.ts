import type {
  DesignerBlueprintTabShowInput,
  DesignerCanvasRouteTabShowInput,
} from "./canvas-tab-tool.js";
import {
  CodexRuntimeMcpServersInstallAction,
  DesignerBlueprintTabUpsertAction,
  DesignerCanvasTabOpenAction,
  DesignerUserInputRequestAction,
} from "./constants.js";
import type { CodexRuntimeMcpServersInstallInput } from "./runtime-mcp-servers-install-tool.js";
import type { DesignerUserInputRequestInput } from "./user-input-tool.js";

export type DashboardControlActionRequest =
  | {
      action: typeof DesignerCanvasTabOpenAction;
      input: DesignerCanvasRouteTabShowInput;
    }
  | {
      action: typeof DesignerBlueprintTabUpsertAction;
      input: DesignerBlueprintTabShowInput;
    }
  | {
      action: typeof DesignerUserInputRequestAction;
      input: DesignerUserInputRequestInput;
    }
  | {
      action: typeof CodexRuntimeMcpServersInstallAction;
      input: CodexRuntimeMcpServersInstallInput;
    };

export type DashboardControlCanvasActionRequest = Exclude<
  DashboardControlActionRequest,
  { action: typeof DesignerUserInputRequestAction | typeof CodexRuntimeMcpServersInstallAction }
>;

export type DashboardControlActionHandler = (
  request: DashboardControlCanvasActionRequest,
) => Promise<void>;

export type DashboardControlActionSupport = {
  supportedActions: readonly string[];
  handleAction: DashboardControlActionHandler;
  runtimeMcpServersInstallAction?: {
    designerSessionId: string;
  };
  userInputSubmitAction?: {
    designerSessionId: string;
  };
};

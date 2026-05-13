export type CommandApprovalRequestEntry = {
  requestId: string | number;
  method: "item/commandExecution/requestApproval";
  kind: "command-approval";
  threadId: string;
  turnId: string;
  itemId: string;
  reason: string | null;
  command: string | null;
  cwd: string | null;
  availableDecisions: readonly string[];
  networkHost: string | null;
  networkProtocol: string | null;
  networkPort: string | null;
  status: "pending" | "responding";
  responseErrorMessage: string | null;
};

export type FileChangeApprovalRequestEntry = {
  requestId: string | number;
  method: "item/fileChange/requestApproval";
  kind: "file-change-approval";
  threadId: string;
  turnId: string;
  itemId: string;
  reason: string | null;
  grantRoot: string | null;
  availableDecisions: readonly string[];
  status: "pending" | "responding";
  responseErrorMessage: string | null;
};

export type ToolRequestUserInputEntry = {
  requestId: string | number;
  method: "tool/requestUserInput";
  kind: "tool-user-input";
  questions: readonly {
    header: string | null;
    id: string;
    options: readonly {
      label: string;
      description: string | null;
      isOther: boolean;
    }[];
    question: string;
  }[];
  status: "pending" | "responding";
  responseErrorMessage: string | null;
};

export type OpenCodePermissionApprovalRequestEntry = {
  requestId: string;
  method: "opencode/permission/requestApproval";
  kind: "opencode-permission";
  sessionId: string;
  permission: string;
  patterns: readonly string[];
  availableDecisions: readonly string[];
  status: "pending" | "responding";
  responseErrorMessage: string | null;
};

export type ServerRequestEntry =
  | CommandApprovalRequestEntry
  | FileChangeApprovalRequestEntry
  | ToolRequestUserInputEntry
  | OpenCodePermissionApprovalRequestEntry;

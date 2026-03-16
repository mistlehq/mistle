import type {
  CodexJsonRpcId,
  CodexJsonRpcNotification,
  CodexJsonRpcServerRequest,
} from "@mistle/integrations-definitions/openai/agent/browser";
import { z } from "zod";

const AvailableDecisionsSchema = z.array(z.string()).optional();
const DefaultCommandApprovalDecisions = ["accept", "acceptForSession", "decline", "cancel"];
const DefaultFileChangeApprovalDecisions = ["accept", "acceptForSession", "decline", "cancel"];

function normalizeAvailableDecisions(
  availableDecisions: readonly string[] | undefined,
  defaultDecisions: readonly string[],
): readonly string[] {
  if (availableDecisions === undefined || availableDecisions.length === 0) {
    return defaultDecisions;
  }

  return availableDecisions;
}

const CommandApprovalRequestSchema = z.object({
  id: z.union([z.number(), z.string()]),
  method: z.literal("item/commandExecution/requestApproval"),
  params: z.looseObject({
    itemId: z.string().min(1),
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    reason: z.string().nullable().optional(),
    command: z.string().nullable().optional(),
    cwd: z.string().nullable().optional(),
    availableDecisions: AvailableDecisionsSchema,
    networkApprovalContext: z
      .looseObject({
        host: z.string().nullable().optional(),
        protocol: z.string().nullable().optional(),
        port: z.union([z.number(), z.string()]).nullable().optional(),
      })
      .nullable()
      .optional(),
  }),
});

const FileChangeApprovalRequestSchema = z.object({
  id: z.union([z.number(), z.string()]),
  method: z.literal("item/fileChange/requestApproval"),
  params: z.looseObject({
    itemId: z.string().min(1),
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    reason: z.string().nullable().optional(),
    grantRoot: z.string().nullable().optional(),
    availableDecisions: AvailableDecisionsSchema,
  }),
});

const ToolRequestUserInputOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
  isOther: z.boolean().optional(),
});

const ToolRequestUserInputQuestionSchema = z.object({
  header: z.string().optional(),
  id: z.string().min(1),
  options: z.array(ToolRequestUserInputOptionSchema).optional(),
  question: z.string().min(1),
});

const ToolRequestUserInputSchema = z.object({
  id: z.union([z.number(), z.string()]),
  method: z.literal("tool/requestUserInput"),
  params: z.looseObject({
    questions: z.array(ToolRequestUserInputQuestionSchema).min(1).max(3),
  }),
});

const ServerRequestResolvedNotificationSchema = z.object({
  method: z.literal("serverRequest/resolved"),
  params: z.looseObject({
    requestId: z.union([z.number(), z.string()]).optional(),
    id: z.union([z.number(), z.string()]).optional(),
  }),
});

export type CodexCommandApprovalRequestEntry = {
  requestId: CodexJsonRpcId;
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

export type CodexFileChangeApprovalRequestEntry = {
  requestId: CodexJsonRpcId;
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

export type CodexToolRequestUserInputEntry = {
  requestId: CodexJsonRpcId;
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

export type CodexServerRequestEntry =
  | CodexCommandApprovalRequestEntry
  | CodexFileChangeApprovalRequestEntry
  | CodexToolRequestUserInputEntry;

export type CodexServerRequestsState = {
  entries: readonly CodexServerRequestEntry[];
};

export type CodexServerRequestsAction =
  | {
      type: "reset";
    }
  | {
      type: "server_request_received";
      request: CodexJsonRpcServerRequest;
    }
  | {
      type: "server_request_response_started";
      requestId: CodexJsonRpcId;
    }
  | {
      type: "server_request_response_failed";
      requestId: CodexJsonRpcId;
      errorMessage: string;
    }
  | {
      type: "notification_received";
      notification: CodexJsonRpcNotification;
    };

export function createInitialCodexServerRequestsState(): CodexServerRequestsState {
  return {
    entries: [],
  };
}

function hasMatchingRequestId(
  entryRequestId: CodexJsonRpcId,
  targetRequestId: CodexJsonRpcId,
): boolean {
  return String(entryRequestId) === String(targetRequestId);
}

function upsertEntry(
  entries: readonly CodexServerRequestEntry[],
  nextEntry: CodexServerRequestEntry,
): readonly CodexServerRequestEntry[] {
  const nextEntries = entries.filter(
    (entry) => !hasMatchingRequestId(entry.requestId, nextEntry.requestId),
  );
  return [nextEntry, ...nextEntries];
}

function markEntryResponding(
  entries: readonly CodexServerRequestEntry[],
  requestId: CodexJsonRpcId,
): readonly CodexServerRequestEntry[] {
  return entries.map((entry) => {
    if (!hasMatchingRequestId(entry.requestId, requestId)) {
      return entry;
    }

    return {
      ...entry,
      status: "responding",
      responseErrorMessage: null,
    };
  });
}

function markEntryResponseFailed(
  entries: readonly CodexServerRequestEntry[],
  requestId: CodexJsonRpcId,
  errorMessage: string,
): readonly CodexServerRequestEntry[] {
  return entries.map((entry) => {
    if (!hasMatchingRequestId(entry.requestId, requestId)) {
      return entry;
    }

    return {
      ...entry,
      status: "pending",
      responseErrorMessage: errorMessage,
    };
  });
}

function removeEntry(
  entries: readonly CodexServerRequestEntry[],
  requestId: CodexJsonRpcId,
): readonly CodexServerRequestEntry[] {
  return entries.filter((entry) => !hasMatchingRequestId(entry.requestId, requestId));
}

function toServerRequestEntry(request: CodexJsonRpcServerRequest): CodexServerRequestEntry | null {
  const commandApproval = CommandApprovalRequestSchema.safeParse(request);
  if (commandApproval.success) {
    return {
      requestId: commandApproval.data.id,
      method: commandApproval.data.method,
      kind: "command-approval",
      threadId: commandApproval.data.params.threadId,
      turnId: commandApproval.data.params.turnId,
      itemId: commandApproval.data.params.itemId,
      reason: commandApproval.data.params.reason ?? null,
      command: commandApproval.data.params.command ?? null,
      cwd: commandApproval.data.params.cwd ?? null,
      availableDecisions: normalizeAvailableDecisions(
        commandApproval.data.params.availableDecisions,
        DefaultCommandApprovalDecisions,
      ),
      networkHost: commandApproval.data.params.networkApprovalContext?.host ?? null,
      networkProtocol: commandApproval.data.params.networkApprovalContext?.protocol ?? null,
      networkPort:
        commandApproval.data.params.networkApprovalContext?.port === undefined ||
        commandApproval.data.params.networkApprovalContext.port === null
          ? null
          : String(commandApproval.data.params.networkApprovalContext.port),
      status: "pending",
      responseErrorMessage: null,
    };
  }

  const fileChangeApproval = FileChangeApprovalRequestSchema.safeParse(request);
  if (fileChangeApproval.success) {
    return {
      requestId: fileChangeApproval.data.id,
      method: fileChangeApproval.data.method,
      kind: "file-change-approval",
      threadId: fileChangeApproval.data.params.threadId,
      turnId: fileChangeApproval.data.params.turnId,
      itemId: fileChangeApproval.data.params.itemId,
      reason: fileChangeApproval.data.params.reason ?? null,
      grantRoot: fileChangeApproval.data.params.grantRoot ?? null,
      availableDecisions: normalizeAvailableDecisions(
        fileChangeApproval.data.params.availableDecisions,
        DefaultFileChangeApprovalDecisions,
      ),
      status: "pending",
      responseErrorMessage: null,
    };
  }

  const toolRequestUserInput = ToolRequestUserInputSchema.safeParse(request);
  if (toolRequestUserInput.success) {
    return {
      requestId: toolRequestUserInput.data.id,
      method: toolRequestUserInput.data.method,
      kind: "tool-user-input",
      questions: toolRequestUserInput.data.params.questions.map((question) => ({
        header: question.header ?? null,
        id: question.id,
        options: (question.options ?? []).map((option) => ({
          label: option.label,
          description: option.description ?? null,
          isOther: option.isOther ?? false,
        })),
        question: question.question,
      })),
      status: "pending",
      responseErrorMessage: null,
    };
  }

  return null;
}

function resolveNotificationRequestId(
  notification: CodexJsonRpcNotification,
): CodexJsonRpcId | null {
  const resolved = ServerRequestResolvedNotificationSchema.safeParse(notification);
  if (!resolved.success) {
    return null;
  }

  return resolved.data.params.requestId ?? resolved.data.params.id ?? null;
}

export function reduceCodexServerRequestsState(
  state: CodexServerRequestsState,
  action: CodexServerRequestsAction,
): CodexServerRequestsState {
  if (action.type === "reset") {
    return createInitialCodexServerRequestsState();
  }

  if (action.type === "server_request_received") {
    const entry = toServerRequestEntry(action.request);
    if (entry === null) {
      return state;
    }

    return {
      ...state,
      entries: upsertEntry(state.entries, entry),
    };
  }

  if (action.type === "server_request_response_started") {
    return {
      ...state,
      entries: markEntryResponding(state.entries, action.requestId),
    };
  }

  if (action.type === "server_request_response_failed") {
    return {
      ...state,
      entries: markEntryResponseFailed(state.entries, action.requestId, action.errorMessage),
    };
  }

  const requestId = resolveNotificationRequestId(action.notification);
  if (requestId === null) {
    return state;
  }

  return {
    ...state,
    entries: removeEntry(state.entries, requestId),
  };
}

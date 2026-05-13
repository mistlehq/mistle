import type {
  OpenCodeEvent,
  OpenCodeMessage,
  OpenCodeMessagePart,
  OpenCodeMessageWithParts,
  OpenCodePermissionRequest,
} from "@mistle/integrations-definitions/agent-runtimes/opencode/client";

import {
  formatSemanticChatDetail,
  projectSemanticChatEntries,
  shouldSuppressChatReasoningText,
  type SemanticChatProjectionItem,
} from "../../../chat/chat-semantic-projection.js";
import type { ChatAttachment, ChatEntry, ChatGenericItemEntry } from "../../../chat/chat-types.js";

type OpenCodeMessageState = {
  info: OpenCodeMessage;
  partsById: Readonly<Record<string, OpenCodeMessagePart>>;
  partOrder: readonly string[];
};

export type OpenCodeChatState = {
  completedErrorMessage: string | null;
  entries: readonly ChatEntry[];
  messageOrder: readonly string[];
  messagesById: Readonly<Record<string, OpenCodeMessageState>>;
  pendingPermissions: readonly OpenCodePermissionRequest[];
  sessionId: string | null;
  status: "busy" | "failed" | "idle" | null;
};

export type OpenCodeChatAction =
  | {
      bufferedEvents?: readonly OpenCodeEvent[];
      messages: readonly OpenCodeMessageWithParts[];
      pendingPermissions?: readonly OpenCodePermissionRequest[];
      sessionId: string;
      type: "hydrate_messages";
    }
  | {
      event: OpenCodeEvent;
      type: "event_received";
    };

function isTerminalPart(part: OpenCodeMessagePart, message: OpenCodeMessage): boolean {
  if (part.type === "text") {
    return part.time?.end !== undefined || message.role === "assistant";
  }
  if (part.type === "reasoning") {
    return part.time.end !== undefined || message.role === "assistant";
  }
  if (part.type === "tool") {
    return part.state.status === "completed" || part.state.status === "error";
  }
  return true;
}

function createUserEntry(input: {
  message: OpenCodeMessage;
  parts: readonly OpenCodeMessagePart[];
}): ChatEntry | null {
  if (input.message.role !== "user") {
    return null;
  }

  const text = input.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
  const attachments: ChatAttachment[] = input.parts
    .filter((part) => part.type === "file")
    .map((part) => ({
      kind: part.mime.startsWith("image/") ? "image" : "file",
      name: part.filename ?? part.url,
      path: part.source?.type === "file" ? part.source.path : part.url,
    }));

  return {
    id: input.message.id,
    kind: "user-message",
    text,
    turnId: input.message.id,
    status: "completed",
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function readStringProperty(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecordProperty(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function readFirstStringProperty(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = readStringProperty(record, key);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function createOpenCodeToolGenericEntry(input: {
  message: OpenCodeMessage;
  part: Extract<OpenCodeMessagePart, { type: "tool" }>;
  turnId: string;
}): ChatGenericItemEntry {
  const state = input.part.state;
  return {
    id: input.part.id,
    kind: "generic-item",
    itemType: "opencode-tool",
    title: input.part.tool,
    body:
      state.status === "completed"
        ? state.output
        : state.status === "error"
          ? state.error
          : state.status,
    detailsJson: JSON.stringify(state),
    status: isTerminalPart(input.part, input.message) ? "completed" : "streaming",
    turnId: input.turnId,
  };
}

function getOpenCodeToolOutput(
  part: Extract<OpenCodeMessagePart, { type: "tool" }>,
): string | null {
  const state = part.state;
  if (state.status === "completed") {
    return state.output;
  }
  if (state.status === "error") {
    return state.error;
  }
  return null;
}

function getOpenCodeToolInput(
  part: Extract<OpenCodeMessagePart, { type: "tool" }>,
): Record<string, unknown> | null {
  return "input" in part.state ? part.state.input : null;
}

function getOpenCodeToolMetadata(
  part: Extract<OpenCodeMessagePart, { type: "tool" }>,
): Record<string, unknown> | null {
  if (isRecord(part.state)) {
    const stateMetadata = readRecordProperty(part.state, "metadata");
    if (stateMetadata !== null) {
      return stateMetadata;
    }
  }

  return part.metadata === undefined ? null : part.metadata;
}

function getOpenCodeReadPath(toolInput: Record<string, unknown>): string | null {
  return readFirstStringProperty(toolInput, ["filePath", "path", "file"]);
}

function getOpenCodeExploreDetail(input: {
  toolInput: Record<string, unknown>;
  toolName: string;
}): string | null {
  if (input.toolName === "read") {
    return getOpenCodeReadPath(input.toolInput);
  }

  return readFirstStringProperty(input.toolInput, ["filePath", "path", "file", "pattern", "query"]);
}

function getOpenCodeEditPath(toolInput: Record<string, unknown>): string | null {
  return readFirstStringProperty(toolInput, ["filePath", "path", "file"]);
}

function getOpenCodeEditDiff(part: Extract<OpenCodeMessagePart, { type: "tool" }>): string | null {
  const metadata = getOpenCodeToolMetadata(part);
  if (metadata === null) {
    return null;
  }

  return readStringProperty(metadata, "diff");
}

function getOpenCodeToolProjection(input: {
  message: OpenCodeMessage;
  part: Extract<OpenCodeMessagePart, { type: "tool" }>;
  turnId: string;
}): SemanticChatProjectionItem {
  const toolName = input.part.tool.toLowerCase();
  const toolInput = getOpenCodeToolInput(input.part);
  const output = getOpenCodeToolOutput(input.part);
  const status = isTerminalPart(input.part, input.message) ? "completed" : "streaming";

  if ((toolName === "bash" || toolName === "shell") && toolInput !== null) {
    const command = readStringProperty(toolInput, "command");
    if (command !== null) {
      return {
        kind: "semantic",
        id: input.part.id,
        turnId: input.turnId,
        semanticKind: "running-commands",
        status,
        displayKeys: {
          active: "running-commands.active",
          completed: "running-commands.done",
        },
        counts: null,
        sourceKind: "command-execution",
        label: "Command",
        detail: formatSemanticChatDetail({
          detail: command,
          maxLength: 80,
        }),
        sourcePath: null,
        detailKind: "code",
        command,
        output,
      };
    }
  }

  if (
    toolInput !== null &&
    (toolName === "read" ||
      toolName === "grep" ||
      toolName === "glob" ||
      toolName === "list" ||
      toolName === "ls")
  ) {
    const detail = getOpenCodeExploreDetail({
      toolInput,
      toolName,
    });
    return {
      kind: "semantic",
      id: input.part.id,
      turnId: input.turnId,
      semanticKind: "exploring",
      status,
      displayKeys: {
        active: "exploring.active",
        completed: "exploring.done",
      },
      counts: {
        reads: toolName === "read" ? 1 : 0,
        searches: toolName === "grep" || toolName === "glob" ? 1 : 0,
        lists: toolName === "list" || toolName === "ls" ? 1 : 0,
      },
      sourceKind: "tool-call",
      label:
        toolName === "read"
          ? "Read"
          : toolName === "grep" || toolName === "glob"
            ? "Search"
            : "List files",
      detail: formatSemanticChatDetail({
        detail,
        maxLength: 72,
      }),
      sourcePath: detail,
      detailKind: toolName === "grep" || toolName === "glob" ? "plain" : "code",
      command: null,
      output,
    };
  }

  if (toolInput !== null && (toolName === "edit" || toolName === "write" || toolName === "patch")) {
    const detail = getOpenCodeEditPath(toolInput);
    const diff = getOpenCodeEditDiff(input.part);
    if (diff === null) {
      return {
        kind: "standalone",
        entry: createOpenCodeToolGenericEntry(input),
      };
    }

    return {
      kind: "semantic",
      id: input.part.id,
      turnId: input.turnId,
      semanticKind: "making-edits",
      status,
      displayKeys: {
        active: "making-edits.active",
        completed: "making-edits.done",
      },
      counts: null,
      sourceKind: "tool-call",
      label: toolName === "write" ? "Updated" : "File change",
      detail: formatSemanticChatDetail({
        detail,
        maxLength: 88,
      }),
      sourcePath: null,
      detailKind: "code",
      command: null,
      output: diff,
    };
  }

  if (
    toolInput !== null &&
    (toolName === "webfetch" || toolName === "web-search" || toolName === "web_search")
  ) {
    const detail = readFirstStringProperty(toolInput, ["url", "query"]);
    return {
      kind: "semantic",
      id: input.part.id,
      turnId: input.turnId,
      semanticKind: "searching-web",
      status,
      displayKeys: {
        active: "searching-web.active",
        completed: "searching-web.done",
      },
      counts: null,
      sourceKind: "tool-call",
      label: "Web search",
      detail: formatSemanticChatDetail({
        detail,
        maxLength: 72,
      }),
      sourcePath: null,
      detailKind: "plain",
      command: null,
      output,
    };
  }

  return {
    kind: "standalone",
    entry: createOpenCodeToolGenericEntry(input),
  };
}

function readErrorMessage(
  error: Extract<OpenCodeMessage, { role: "assistant" }>["error"],
): string | null {
  if (error === undefined) {
    return null;
  }
  if ("data" in error && typeof error.data === "object" && error.data !== null) {
    const message = readStringProperty(error.data, "message");
    if (message !== null) {
      return message;
    }
  }
  return error.name;
}

function createAssistantEntries(input: {
  message: OpenCodeMessage;
  parts: readonly OpenCodeMessagePart[];
}): readonly ChatEntry[] {
  if (input.message.role !== "assistant") {
    return [];
  }

  const turnId = input.message.parentID;
  const projectionItems: SemanticChatProjectionItem[] = [];
  for (const part of input.parts) {
    if (part.type === "text") {
      projectionItems.push({
        kind: "standalone",
        entry: {
          id: part.id,
          kind: "assistant-message",
          phase: null,
          status: isTerminalPart(part, input.message) ? "completed" : "streaming",
          text: part.text,
          turnId,
        },
      });
      continue;
    }
    if (part.type === "reasoning") {
      if (shouldSuppressChatReasoningText(part.text)) {
        continue;
      }

      projectionItems.push({
        id: part.id,
        kind: "semantic",
        turnId,
        semanticKind: "thinking",
        status: isTerminalPart(part, input.message) ? "completed" : "streaming",
        displayKeys: {
          active: "thinking.active",
          completed: "thinking.done",
        },
        counts: null,
        sourceKind: "reasoning",
        label: "Thought",
        detail: formatSemanticChatDetail({
          detail: part.text,
          maxLength: 88,
        }),
        sourcePath: null,
        detailKind: "plain",
        command: null,
        output: part.text,
      });
      continue;
    }
    if (part.type === "tool") {
      projectionItems.push(
        getOpenCodeToolProjection({
          message: input.message,
          part,
          turnId,
        }),
      );
    }
  }

  const entries = [...projectSemanticChatEntries(projectionItems)];
  const errorMessage = readErrorMessage(input.message.error);
  if (errorMessage !== null) {
    entries.push({
      id: `${input.message.id}:error`,
      kind: "generic-item",
      itemType: "opencode-error",
      title: "OpenCode error",
      body: errorMessage,
      detailsJson: JSON.stringify(input.message.error),
      status: "completed",
      turnId,
    });
  }

  return entries;
}

function buildEntries(state: Omit<OpenCodeChatState, "entries">): readonly ChatEntry[] {
  const entries: ChatEntry[] = [];
  for (const messageId of state.messageOrder) {
    const message = state.messagesById[messageId];
    if (message === undefined) {
      continue;
    }

    const parts = message.partOrder.flatMap((partId) => {
      const part = message.partsById[partId];
      return part === undefined ? [] : [part];
    });
    const userEntry = createUserEntry({
      message: message.info,
      parts,
    });
    if (userEntry !== null) {
      entries.push(userEntry);
      continue;
    }
    entries.push(
      ...createAssistantEntries({
        message: message.info,
        parts,
      }),
    );
  }

  for (const permission of state.pendingPermissions) {
    entries.push({
      id: `permission:${permission.id}`,
      kind: "generic-item",
      itemType: "opencode-permission",
      title: "Permission requested",
      body: `${permission.permission}: ${permission.patterns.join(", ")}`,
      detailsJson: JSON.stringify(permission),
      status: "streaming",
      turnId: permission.sessionID,
    });
  }

  return entries;
}

function rebuildState(state: Omit<OpenCodeChatState, "entries">): OpenCodeChatState {
  return {
    ...state,
    entries: buildEntries(state),
  };
}

export function createInitialOpenCodeChatState(): OpenCodeChatState {
  return {
    completedErrorMessage: null,
    entries: [],
    messageOrder: [],
    messagesById: {},
    pendingPermissions: [],
    sessionId: null,
    status: null,
  };
}

function createMessageState(message: OpenCodeMessageWithParts): OpenCodeMessageState {
  return {
    info: message.info,
    partOrder: message.parts.map((part) => part.id),
    partsById: Object.fromEntries(message.parts.map((part) => [part.id, part])),
  };
}

function upsertMessage(input: {
  message: OpenCodeMessage;
  messageOrder: readonly string[];
  messagesById: Readonly<Record<string, OpenCodeMessageState>>;
}): Pick<OpenCodeChatState, "messageOrder" | "messagesById"> {
  const existing = input.messagesById[input.message.id];
  return {
    messageOrder:
      existing === undefined ? [...input.messageOrder, input.message.id] : input.messageOrder,
    messagesById: {
      ...input.messagesById,
      [input.message.id]: {
        info: input.message,
        partOrder: existing?.partOrder ?? [],
        partsById: existing?.partsById ?? {},
      },
    },
  };
}

function upsertPart(input: {
  messageOrder: readonly string[];
  messagesById: Readonly<Record<string, OpenCodeMessageState>>;
  part: OpenCodeMessagePart;
}): Pick<OpenCodeChatState, "messageOrder" | "messagesById"> {
  const existing = input.messagesById[input.part.messageID];
  if (existing === undefined) {
    throw new Error(
      `OpenCode part '${input.part.id}' referenced unknown message '${input.part.messageID}'.`,
    );
  }

  return {
    messageOrder: input.messageOrder,
    messagesById: {
      ...input.messagesById,
      [input.part.messageID]: {
        ...existing,
        partOrder: existing.partOrder.includes(input.part.id)
          ? existing.partOrder
          : [...existing.partOrder, input.part.id],
        partsById: {
          ...existing.partsById,
          [input.part.id]: input.part,
        },
      },
    },
  };
}

function applyPartDelta(input: {
  delta: string;
  field: string;
  messageId: string;
  messageOrder: readonly string[];
  messagesById: Readonly<Record<string, OpenCodeMessageState>>;
  partId: string;
}): Pick<OpenCodeChatState, "messageOrder" | "messagesById"> {
  if (input.field !== "text") {
    throw new Error(`OpenCode part delta field '${input.field}' is not supported.`);
  }
  const message = input.messagesById[input.messageId];
  const part = message?.partsById[input.partId];
  if (message === undefined || part === undefined) {
    throw new Error(
      `OpenCode part delta referenced unknown part '${input.partId}' on message '${input.messageId}'.`,
    );
  }
  if (part.type !== "text" && part.type !== "reasoning") {
    throw new Error(`OpenCode text delta is not supported for part type '${part.type}'.`);
  }

  return upsertPart({
    messageOrder: input.messageOrder,
    messagesById: input.messagesById,
    part: {
      ...part,
      text: `${part.text}${input.delta}`,
    },
  });
}

function getOpenCodePayloadSessionId(payload: OpenCodeEvent["payload"]): string | null {
  switch (payload.type) {
    case "message.updated":
    case "message.part.updated":
    case "message.part.delta":
    case "session.status":
    case "session.idle":
    case "permission.asked":
    case "permission.replied":
    case "session.diff":
      return payload.properties.sessionID;
    case "session.error":
      return payload.properties.sessionID ?? null;
    default:
      return null;
  }
}

function shouldApplyOpenCodePayload(
  state: OpenCodeChatState,
  payload: OpenCodeEvent["payload"],
): boolean {
  const payloadSessionId = getOpenCodePayloadSessionId(payload);
  return (
    state.sessionId === null || payloadSessionId === null || payloadSessionId === state.sessionId
  );
}

function reduceOpenCodePayload(
  state: OpenCodeChatState,
  payload: OpenCodeEvent["payload"],
): OpenCodeChatState {
  if (!shouldApplyOpenCodePayload(state, payload)) {
    return state;
  }
  if (payload.type === "message.updated") {
    const updated = upsertMessage({
      message: payload.properties.info,
      messageOrder: state.messageOrder,
      messagesById: state.messagesById,
    });
    return rebuildState({
      ...state,
      ...updated,
      sessionId: payload.properties.sessionID,
    });
  }
  if (payload.type === "message.part.updated") {
    const updated = upsertPart({
      messageOrder: state.messageOrder,
      messagesById: state.messagesById,
      part: payload.properties.part,
    });
    return rebuildState({
      ...state,
      ...updated,
      sessionId: payload.properties.sessionID,
    });
  }
  if (payload.type === "message.part.delta") {
    const updated = applyPartDelta({
      delta: payload.properties.delta,
      field: payload.properties.field,
      messageId: payload.properties.messageID,
      messageOrder: state.messageOrder,
      messagesById: state.messagesById,
      partId: payload.properties.partID,
    });
    return rebuildState({
      ...state,
      ...updated,
      sessionId: payload.properties.sessionID,
    });
  }
  if (payload.type === "session.status") {
    const status = payload.properties.status.type;
    return rebuildState({
      ...state,
      sessionId: payload.properties.sessionID,
      status: status === "busy" || status === "retry" ? "busy" : "idle",
    });
  }
  if (payload.type === "session.idle") {
    return rebuildState({
      ...state,
      sessionId: payload.properties.sessionID,
      status: "idle",
    });
  }
  if (payload.type === "session.error") {
    const errorMessage =
      payload.properties.error === undefined
        ? "OpenCode session failed."
        : readErrorMessage(payload.properties.error);
    return rebuildState({
      ...state,
      completedErrorMessage: errorMessage,
      sessionId: payload.properties.sessionID ?? state.sessionId,
      status: "failed",
    });
  }
  if (payload.type === "permission.asked") {
    return rebuildState({
      ...state,
      pendingPermissions: [
        ...state.pendingPermissions.filter((permission) => permission.id !== payload.properties.id),
        payload.properties,
      ],
    });
  }
  if (payload.type === "permission.replied") {
    return rebuildState({
      ...state,
      pendingPermissions: state.pendingPermissions.filter(
        (permission) => permission.id !== payload.properties.requestID,
      ),
    });
  }
  if (payload.type === "session.diff") {
    return state;
  }
  return state;
}

export function reduceOpenCodeChatState(
  state: OpenCodeChatState,
  action: OpenCodeChatAction,
): OpenCodeChatState {
  if (action.type === "hydrate_messages") {
    const messagesById = Object.fromEntries(
      action.messages.map((message) => [message.info.id, createMessageState(message)]),
    );
    const hydrated = rebuildState({
      ...createInitialOpenCodeChatState(),
      messageOrder: action.messages.map((message) => message.info.id),
      messagesById,
      pendingPermissions: (action.pendingPermissions ?? []).filter(
        (permission) => permission.sessionID === action.sessionId,
      ),
      sessionId: action.sessionId,
    });
    return (action.bufferedEvents ?? []).reduce(
      (currentState, event) => reduceOpenCodePayload(currentState, event.payload),
      hydrated,
    );
  }

  return reduceOpenCodePayload(state, action.event.payload);
}

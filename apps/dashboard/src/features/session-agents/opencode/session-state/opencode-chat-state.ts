import type {
  OpenCodeEvent,
  OpenCodeMessage,
  OpenCodeMessagePart,
  OpenCodeMessageWithParts,
  OpenCodePermissionRequest,
} from "@mistle/integrations-definitions/agent-runtimes/opencode/client";

import type {
  ChatAttachment,
  ChatCommandEntry,
  ChatEntry,
  ChatGenericItemEntry,
} from "../../../chat/chat-types.js";

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
      kind: "file",
      name: part.filename ?? part.url,
      path: part.url,
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

function createToolEntry(input: {
  message: OpenCodeMessage;
  part: Extract<OpenCodeMessagePart, { type: "tool" }>;
  turnId: string;
}): ChatCommandEntry | ChatGenericItemEntry {
  const state = input.part.state;
  const command = "input" in state ? readStringProperty(state.input, "command") : null;
  if ((input.part.tool === "bash" || input.part.tool === "shell") && command !== null) {
    return {
      id: input.part.id,
      kind: "command-execution",
      command,
      output:
        state.status === "completed" ? state.output : state.status === "error" ? state.error : null,
      cwd: readStringProperty(state.input, "cwd"),
      exitCode: null,
      commandStatus: state.status,
      reason: input.part.tool,
      status: isTerminalPart(input.part, input.message) ? "completed" : "streaming",
      turnId: input.turnId,
    };
  }

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
  const entries: ChatEntry[] = [];
  for (const part of input.parts) {
    if (part.type === "text") {
      entries.push({
        id: part.id,
        kind: "assistant-message",
        phase: null,
        status: isTerminalPart(part, input.message) ? "completed" : "streaming",
        text: part.text,
        turnId,
      });
      continue;
    }
    if (part.type === "reasoning") {
      entries.push({
        id: part.id,
        kind: "reasoning",
        source: "content",
        status: isTerminalPart(part, input.message) ? "completed" : "streaming",
        summary: part.text,
        turnId,
      });
      continue;
    }
    if (part.type === "tool") {
      entries.push(
        createToolEntry({
          message: input.message,
          part,
          turnId,
        }),
      );
    }
  }

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

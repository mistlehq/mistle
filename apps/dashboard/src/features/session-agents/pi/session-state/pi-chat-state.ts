import type {
  PiAgentMessage,
  PiEvent,
} from "@mistle/integrations-definitions/agent-runtimes/pi/client";

import {
  formatSemanticChatDetail,
  projectSemanticChatEntries,
  shouldSuppressChatReasoningText,
  type SemanticChatProjectionItem,
} from "../../../chat/chat-semantic-projection.js";
import type {
  ChatAttachment,
  ChatEntry,
  ChatSemanticGroupEntry,
} from "../../../chat/chat-types.js";

type PiToolCall = {
  args: unknown;
  id: string;
  name: string;
};

type PiToolExecution = {
  args: unknown;
  output: string | null;
  status: "completed" | "streaming";
  toolCallId: string;
  toolName: string;
};

type PiUserMessagePresentation = {
  attachments: readonly ChatAttachment[];
  text: string;
};

const EmptyPiFileMarkerPattern = /<file\s+name="([^"]*)">\s*<\/file>/g;
const ImageFileExtensionPattern = /\.(?:avif|gif|heic|jpeg|jpg|png|webp)$/i;

export type PiChatState = {
  completedErrorMessage: string | null;
  entries: readonly ChatEntry[];
  messages: readonly PiAgentMessage[];
  pendingToolExecutions: readonly PiToolExecution[];
  pendingTurnId: string | null;
  sessionFile: string | null;
  status: "busy" | "failed" | "idle" | null;
  streamingMessage: PiAgentMessage | null;
};

export type PiChatAction =
  | {
      bufferedEvents?: readonly PiEvent[];
      messages: readonly PiAgentMessage[];
      sessionFile: string;
      status?: "busy" | "idle";
      type: "hydrate_messages";
    }
  | {
      event: PiEvent;
      type: "event_received";
    }
  | {
      sessionFile: string;
      submittedPrompt: string;
      type: "prompt_submitted";
    }
  | {
      errorMessage: string;
      type: "turn_failed";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringProperty(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readFirstStringProperty(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = readStringProperty(record, key);
    if (value !== null && value.length > 0) {
      return value;
    }
  }

  return null;
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    Array.isArray(value) ||
    isRecord(value)
  ) {
    return JSON.stringify(value, null, 2);
  }
  return "";
}

function stringifyDetails(value: unknown): string | null {
  const details = JSON.stringify(value);
  return details === undefined ? null : details;
}

function readMessageTextContentForTypes(input: {
  content: unknown;
  partTypes: readonly string[];
}): string {
  const allowedPartTypes = new Set(input.partTypes);
  if (typeof input.content === "string") {
    return allowedPartTypes.has("text") ? input.content : "";
  }
  if (!Array.isArray(input.content)) {
    return "";
  }

  return input.content
    .flatMap((part) => {
      if (!isRecord(part)) {
        return [];
      }
      const partType = readStringProperty(part, "type");
      if (partType === "text" && allowedPartTypes.has("text")) {
        return [readStringProperty(part, "text") ?? ""];
      }
      if (partType === "thinking" && allowedPartTypes.has("thinking")) {
        return [readStringProperty(part, "thinking") ?? ""];
      }
      return [];
    })
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function readMessageTextContent(content: unknown): string {
  return readMessageTextContentForTypes({
    content,
    partTypes: ["text", "thinking"],
  });
}

function decodePiFileMarkerAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

function getFileNameFromPath(path: string): string {
  const segments = path.split("/");
  return segments.at(-1) ?? path;
}

function buildChatAttachmentFromPiFileMarker(path: string): ChatAttachment {
  return {
    kind: ImageFileExtensionPattern.test(path) ? "image" : "file",
    path,
    name: getFileNameFromPath(path),
  };
}

function buildPiUserMessagePresentation(content: unknown): PiUserMessagePresentation {
  const textContent = readMessageTextContent(content);
  const attachments: ChatAttachment[] = [];
  const text = textContent
    .replaceAll(EmptyPiFileMarkerPattern, (_match, encodedPath: string) => {
      const path = decodePiFileMarkerAttribute(encodedPath);
      attachments.push(buildChatAttachmentFromPiFileMarker(path));
      return "";
    })
    .trim();

  return {
    attachments,
    text,
  };
}

function readAssistantTextContent(content: unknown): string {
  return readMessageTextContentForTypes({
    content,
    partTypes: ["text"],
  });
}

function readThinkingContent(content: unknown): string {
  return readMessageTextContentForTypes({
    content,
    partTypes: ["thinking"],
  });
}

function isToolCallPart(part: unknown): part is Record<string, unknown> {
  return isRecord(part) && readStringProperty(part, "type") === "toolCall";
}

function readToolCallParts(content: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(isToolCallPart);
}

function isToolCallOnlyContent(content: unknown): boolean {
  return Array.isArray(content) && content.length > 0 && content.every(isToolCallPart);
}

function createMessageId(input: {
  index: number;
  message: PiAgentMessage;
  prefix: string;
}): string {
  const timestamp = input.message.timestamp ?? input.index;
  return `${input.prefix}:${input.message.role}:${timestamp}:${input.index}`;
}

function getPiToolSemanticKind(toolName: string): ChatSemanticGroupEntry["semanticKind"] {
  switch (toolName.toLowerCase()) {
    case "read":
    case "grep":
    case "find":
    case "ls":
      return "exploring";
    case "bash":
      return "running-commands";
    case "edit":
    case "write":
      return "making-edits";
    default:
      return "tool-call";
  }
}

function getDisplayKeys(
  semanticKind: ChatSemanticGroupEntry["semanticKind"],
): ChatSemanticGroupEntry["displayKeys"] {
  return {
    active: `${semanticKind}.active`,
    completed: `${semanticKind}.done`,
  };
}

function getPiToolLabel(toolName: string): string {
  switch (toolName.toLowerCase()) {
    case "read":
      return "Read";
    case "grep":
    case "find":
      return "Search";
    case "ls":
      return "List files";
    case "bash":
      return "Command";
    case "edit":
      return "File change";
    case "write":
      return "Updated";
    default:
      return toolName;
  }
}

function getPiToolDetail(input: { args: unknown; toolName: string }): string | null {
  if (!isRecord(input.args)) {
    return formatSemanticChatDetail({
      detail: formatUnknownValue(input.args),
      maxLength: 88,
    });
  }

  const toolName = input.toolName.toLowerCase();
  if (toolName === "bash") {
    return formatSemanticChatDetail({
      detail: readStringProperty(input.args, "command"),
      maxLength: 80,
    });
  }

  if (toolName === "read" || toolName === "ls") {
    return formatSemanticChatDetail({
      detail: readFirstStringProperty(input.args, ["path", "filePath", "file"]),
      maxLength: 72,
    });
  }

  if (toolName === "grep" || toolName === "find") {
    return formatSemanticChatDetail({
      detail: readFirstStringProperty(input.args, ["pattern", "query", "path", "glob"]),
      maxLength: 72,
    });
  }

  if (toolName === "edit" || toolName === "write") {
    return formatSemanticChatDetail({
      detail: readFirstStringProperty(input.args, ["path", "filePath", "file"]),
      maxLength: 88,
    });
  }

  return formatSemanticChatDetail({
    detail: formatUnknownValue(input.args),
    maxLength: 72,
  });
}

function getPiToolCounts(input: {
  semanticKind: ChatSemanticGroupEntry["semanticKind"];
  toolName: string;
}): ChatSemanticGroupEntry["counts"] {
  if (input.semanticKind !== "exploring") {
    return null;
  }

  const toolName = input.toolName.toLowerCase();
  return {
    reads: toolName === "read" ? 1 : 0,
    searches: toolName === "grep" || toolName === "find" ? 1 : 0,
    lists: toolName === "ls" ? 1 : 0,
  };
}

function getPiToolCommand(input: { args: unknown; toolName: string }): string | null {
  if (input.toolName.toLowerCase() !== "bash" || !isRecord(input.args)) {
    return null;
  }

  return readStringProperty(input.args, "command");
}

function createPiToolProjection(input: {
  args: unknown;
  id: string;
  output: string | null;
  status: "completed" | "streaming";
  toolName: string;
  turnId: string;
}): SemanticChatProjectionItem {
  const semanticKind = getPiToolSemanticKind(input.toolName);
  const detail = getPiToolDetail({
    args: input.args,
    toolName: input.toolName,
  });
  return {
    kind: "semantic",
    id: input.id,
    turnId: input.turnId,
    semanticKind,
    status: input.status,
    displayKeys: getDisplayKeys(semanticKind),
    counts: getPiToolCounts({
      semanticKind,
      toolName: input.toolName,
    }),
    sourceKind: "tool-call",
    label: getPiToolLabel(input.toolName),
    detail,
    sourcePath: semanticKind === "exploring" ? detail : null,
    detailKind: semanticKind === "running-commands" ? "code" : "plain",
    command: getPiToolCommand({
      args: input.args,
      toolName: input.toolName,
    }),
    output: input.output,
  };
}

function readToolCall(part: Record<string, unknown>): PiToolCall | null {
  const id = readStringProperty(part, "id");
  const name = readStringProperty(part, "name");
  if (id === null || name === null) {
    return null;
  }

  return {
    args: part.arguments,
    id,
    name,
  };
}

function buildMessageProjectionItems(input: {
  knownToolCalls: ReadonlyMap<string, PiToolCall>;
  message: PiAgentMessage;
  messageId: string;
  status: "completed" | "streaming";
}): readonly SemanticChatProjectionItem[] {
  if (input.message.role === "user") {
    const presentation = buildPiUserMessagePresentation(input.message.content);
    return [
      {
        kind: "standalone",
        entry: {
          id: input.messageId,
          kind: "user-message",
          text: presentation.text,
          ...(presentation.attachments.length === 0
            ? {}
            : { attachments: presentation.attachments }),
          turnId: input.messageId,
          status: "completed",
        },
      },
    ];
  }

  if (input.message.role === "assistant") {
    const entries: SemanticChatProjectionItem[] = [];
    const thinking = readThinkingContent(input.message.content);
    if (!shouldSuppressChatReasoningText(thinking)) {
      entries.push({
        kind: "semantic",
        id: `${input.messageId}:thinking`,
        turnId: input.messageId,
        semanticKind: "thinking",
        status: input.status,
        displayKeys: getDisplayKeys("thinking"),
        counts: null,
        sourceKind: "reasoning",
        label: "Thought",
        detail: formatSemanticChatDetail({
          detail: thinking,
          maxLength: 88,
        }),
        sourcePath: null,
        detailKind: "plain",
        command: null,
        output: thinking,
      });
    }

    const text = readAssistantTextContent(input.message.content);
    if (text.length > 0) {
      entries.push({
        kind: "standalone",
        entry: {
          id: input.messageId,
          kind: "assistant-message",
          text,
          phase: null,
          status: input.status,
          turnId: input.messageId,
        },
      });
    }

    if (entries.length === 0 && isToolCallOnlyContent(input.message.content)) {
      return [];
    }

    return entries.length === 0
      ? [
          {
            kind: "standalone",
            entry: {
              id: input.messageId,
              kind: "generic-item",
              itemType: "pi-message",
              title: "Pi message",
              body: formatUnknownValue(input.message),
              detailsJson: stringifyDetails(input.message),
              status: input.status,
              turnId: input.messageId,
            },
          },
        ]
      : entries;
  }

  if (input.message.role === "toolResult") {
    const toolCallId = readStringProperty(input.message, "toolCallId");
    const toolName = readStringProperty(input.message, "toolName");
    if (toolCallId !== null && toolName !== null) {
      const toolCall = input.knownToolCalls.get(toolCallId);
      return [
        createPiToolProjection({
          args: toolCall?.args,
          id: input.messageId,
          output: readMessageTextContent(input.message.content),
          status: input.status,
          toolName,
          turnId: input.messageId,
        }),
      ];
    }

    return [
      {
        kind: "standalone",
        entry: {
          id: input.messageId,
          kind: "generic-item",
          itemType: "pi-tool-result",
          title: readStringProperty(input.message, "toolName") ?? "Tool result",
          body: readMessageTextContent(input.message.content),
          detailsJson: stringifyDetails(input.message),
          status: input.status,
          turnId: input.messageId,
        },
      },
    ];
  }

  return [
    {
      kind: "standalone",
      entry: {
        id: input.messageId,
        kind: "generic-item",
        itemType: "pi-message",
        title: input.message.role,
        body: formatUnknownValue(input.message.content),
        detailsJson: stringifyDetails(input.message),
        status: input.status,
        turnId: input.messageId,
      },
    },
  ];
}

function buildEntries(state: Omit<PiChatState, "entries">): readonly ChatEntry[] {
  const knownToolCalls = new Map<string, PiToolCall>();
  const projectionItems: SemanticChatProjectionItem[] = [];

  for (const [index, message] of state.messages.entries()) {
    const messageId = createMessageId({ index, message, prefix: "pi" });
    if (message.role === "assistant") {
      for (const part of readToolCallParts(message.content)) {
        const toolCall = readToolCall(part);
        if (toolCall !== null) {
          knownToolCalls.set(toolCall.id, toolCall);
        }
      }
    }

    projectionItems.push(
      ...buildMessageProjectionItems({
        knownToolCalls,
        message,
        messageId,
        status: "completed",
      }),
    );
  }

  if (state.streamingMessage !== null) {
    projectionItems.push(
      ...buildMessageProjectionItems({
        knownToolCalls,
        message: state.streamingMessage,
        messageId: createMessageId({
          index: state.messages.length,
          message: state.streamingMessage,
          prefix: "pi-streaming",
        }),
        status: "streaming",
      }),
    );
  }

  projectionItems.push(
    ...state.pendingToolExecutions.map((execution) =>
      createPiToolProjection({
        args: execution.args,
        id: `pi-tool-execution:${execution.toolCallId}`,
        output: execution.output,
        status: execution.status,
        toolName: execution.toolName,
        turnId: state.pendingTurnId ?? `pi-tool-execution:${execution.toolCallId}`,
      }),
    ),
  );

  return projectSemanticChatEntries(projectionItems);
}

function rebuildState(state: Omit<PiChatState, "entries">): PiChatState {
  return {
    ...state,
    entries: buildEntries(state),
  };
}

function readEventMessage(event: PiEvent): PiAgentMessage | null {
  const message = event.message;
  if (!isRecord(message)) {
    return null;
  }
  const role = readStringProperty(message, "role");
  if (role === null) {
    return null;
  }
  return {
    ...message,
    role,
  };
}

function readEventMessages(event: PiEvent): readonly PiAgentMessage[] {
  if (!Array.isArray(event.messages)) {
    return [];
  }

  return event.messages.flatMap((message) => {
    if (!isRecord(message)) {
      return [];
    }
    const role = readStringProperty(message, "role");
    if (role === null) {
      return [];
    }
    return [
      {
        ...message,
        role,
      },
    ];
  });
}

function getMessageDeduplicationKey(message: PiAgentMessage): string {
  return JSON.stringify({
    content: message.content,
    role: message.role,
    timestamp: message.timestamp ?? null,
  });
}

function appendMissingMessages(input: {
  existingMessages: readonly PiAgentMessage[];
  incomingMessages: readonly PiAgentMessage[];
}): readonly PiAgentMessage[] {
  const seenKeys = new Set(input.existingMessages.map(getMessageDeduplicationKey));
  const nextMessages = [...input.existingMessages];
  for (const message of input.incomingMessages) {
    const key = getMessageDeduplicationKey(message);
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    nextMessages.push(message);
  }
  return nextMessages;
}

function appendFinalAgentMessages(input: {
  incomingMessages: readonly PiAgentMessage[];
  state: PiChatState;
}): readonly PiAgentMessage[] {
  if (input.incomingMessages.length === 0) {
    return input.state.messages;
  }

  const firstIncomingMessage = input.incomingMessages[0];
  const lastExistingMessage = input.state.messages.at(-1);
  if (
    input.state.pendingTurnId !== null &&
    firstIncomingMessage !== undefined &&
    firstIncomingMessage.role === "user" &&
    lastExistingMessage?.role === "user" &&
    readMessageTextContent(firstIncomingMessage.content) ===
      readMessageTextContent(lastExistingMessage.content)
  ) {
    return appendMissingMessages({
      existingMessages: [...input.state.messages.slice(0, -1), firstIncomingMessage],
      incomingMessages: input.incomingMessages.slice(1),
    });
  }

  return appendMissingMessages({
    existingMessages: input.state.messages,
    incomingMessages: input.incomingMessages,
  });
}

function readToolResultOutput(result: unknown): string | null {
  if (!isRecord(result)) {
    return formatSemanticChatDetail({
      detail: formatUnknownValue(result),
      maxLength: 2000,
    });
  }

  return readMessageTextContent(result.content);
}

function readToolExecutionStart(event: PiEvent): PiToolExecution | null {
  const toolCallId = readStringProperty(event, "toolCallId");
  const toolName = readStringProperty(event, "toolName");
  if (toolCallId === null || toolName === null) {
    return null;
  }

  return {
    args: event.args,
    output: null,
    status: "streaming",
    toolCallId,
    toolName,
  };
}

function readToolExecutionUpdate(event: PiEvent): PiToolExecution | null {
  const toolCallId = readStringProperty(event, "toolCallId");
  const toolName = readStringProperty(event, "toolName");
  if (toolCallId === null || toolName === null) {
    return null;
  }

  const partialResult = event.partialResult;
  return {
    args: event.args,
    output: readToolResultOutput(partialResult),
    status: "streaming",
    toolCallId,
    toolName,
  };
}

function readToolExecutionEnd(event: PiEvent): PiToolExecution | null {
  const toolCallId = readStringProperty(event, "toolCallId");
  const toolName = readStringProperty(event, "toolName");
  if (toolCallId === null || toolName === null) {
    return null;
  }

  const result = event.result;
  return {
    args: null,
    output: readToolResultOutput(result),
    status: "completed",
    toolCallId,
    toolName,
  };
}

function upsertPendingToolExecution(input: {
  execution: PiToolExecution;
  state: PiChatState;
}): readonly PiToolExecution[] {
  const existing = input.state.pendingToolExecutions.find(
    (execution) => execution.toolCallId === input.execution.toolCallId,
  );
  const nextExecution =
    existing === undefined
      ? input.execution
      : {
          ...existing,
          ...input.execution,
          args: input.execution.args ?? existing.args,
        };

  return [
    ...input.state.pendingToolExecutions.filter(
      (execution) => execution.toolCallId !== input.execution.toolCallId,
    ),
    nextExecution,
  ];
}

function removePendingToolExecution(input: {
  message: PiAgentMessage;
  state: PiChatState;
}): readonly PiToolExecution[] {
  if (input.message.role !== "toolResult") {
    return input.state.pendingToolExecutions;
  }

  const toolCallId = readStringProperty(input.message, "toolCallId");
  if (toolCallId === null) {
    return input.state.pendingToolExecutions;
  }

  return input.state.pendingToolExecutions.filter(
    (execution) => execution.toolCallId !== toolCallId,
  );
}

function appendOrReplacePendingUserMessage(input: {
  message: PiAgentMessage;
  state: PiChatState;
}): readonly PiAgentMessage[] {
  if (input.message.role !== "user" || input.state.pendingTurnId === null) {
    return [...input.state.messages, input.message];
  }
  const lastMessage = input.state.messages.at(-1);
  if (
    lastMessage?.role === "user" &&
    readMessageTextContent(lastMessage.content) === readMessageTextContent(input.message.content)
  ) {
    return [...input.state.messages.slice(0, -1), input.message];
  }
  return [...input.state.messages, input.message];
}

export function createInitialPiChatState(): PiChatState {
  return {
    completedErrorMessage: null,
    entries: [],
    messages: [],
    pendingToolExecutions: [],
    pendingTurnId: null,
    sessionFile: null,
    status: null,
    streamingMessage: null,
  };
}

export function reducePiChatState(state: PiChatState, action: PiChatAction): PiChatState {
  if (action.type === "hydrate_messages") {
    const hydrated = rebuildState({
      ...createInitialPiChatState(),
      messages: action.messages,
      sessionFile: action.sessionFile,
      status: action.status ?? "idle",
    });
    return (action.bufferedEvents ?? []).reduce(
      (currentState, event) =>
        reducePiChatState(currentState, {
          type: "event_received",
          event,
        }),
      hydrated,
    );
  }

  if (action.type === "prompt_submitted") {
    const timestamp = Date.now();
    return rebuildState({
      ...state,
      completedErrorMessage: null,
      messages: [
        ...state.messages,
        {
          role: "user",
          content: action.submittedPrompt,
          timestamp,
        },
      ],
      pendingToolExecutions: [],
      pendingTurnId: `pi:user:${timestamp}`,
      sessionFile: action.sessionFile,
      status: "busy",
    });
  }

  if (action.type === "turn_failed") {
    return rebuildState({
      ...state,
      completedErrorMessage: action.errorMessage,
      pendingToolExecutions: [],
      pendingTurnId: null,
      status: "failed",
      streamingMessage: null,
    });
  }

  const event = action.event;
  if (event.type === "agent_start" || event.type === "turn_start") {
    return rebuildState({
      ...state,
      completedErrorMessage: null,
      status: "busy",
    });
  }
  if (event.type === "message_start" || event.type === "message_update") {
    const message = readEventMessage(event);
    if (message === null) {
      return state;
    }
    return rebuildState({
      ...state,
      status: "busy",
      streamingMessage: message,
    });
  }
  if (event.type === "message_end") {
    const message = readEventMessage(event);
    if (message === null) {
      return rebuildState({
        ...state,
        streamingMessage: null,
      });
    }
    return rebuildState({
      ...state,
      messages: appendOrReplacePendingUserMessage({
        message,
        state,
      }),
      pendingToolExecutions: removePendingToolExecution({
        message,
        state,
      }),
      streamingMessage: null,
    });
  }
  if (event.type === "tool_execution_start") {
    const execution = readToolExecutionStart(event);
    if (execution === null) {
      return state;
    }
    return rebuildState({
      ...state,
      pendingToolExecutions: upsertPendingToolExecution({
        execution,
        state,
      }),
      status: "busy",
    });
  }
  if (event.type === "tool_execution_update") {
    const execution = readToolExecutionUpdate(event);
    if (execution === null) {
      return state;
    }
    return rebuildState({
      ...state,
      pendingToolExecutions: upsertPendingToolExecution({
        execution,
        state,
      }),
      status: "busy",
    });
  }
  if (event.type === "tool_execution_end") {
    const execution = readToolExecutionEnd(event);
    if (execution === null) {
      return state;
    }
    return rebuildState({
      ...state,
      pendingToolExecutions: upsertPendingToolExecution({
        execution,
        state,
      }),
      status: "busy",
    });
  }
  if (event.type === "agent_end") {
    const finalMessages = readEventMessages(event);
    return rebuildState({
      ...state,
      messages:
        finalMessages.length === 0
          ? state.messages
          : appendFinalAgentMessages({
              incomingMessages: finalMessages,
              state,
            }),
      pendingToolExecutions: [],
      pendingTurnId: null,
      status: "idle",
      streamingMessage: null,
    });
  }

  return state;
}

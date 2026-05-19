import type {
  PiAgentMessage,
  PiEvent,
} from "@mistle/integrations-definitions/agent-runtimes/pi/client";

import type { ChatEntry } from "../../../chat/chat-types.js";

export type PiChatState = {
  completedErrorMessage: string | null;
  entries: readonly ChatEntry[];
  messages: readonly PiAgentMessage[];
  pendingTurnId: string | null;
  sessionFile: string | null;
  status: "busy" | "failed" | "idle" | null;
  streamingMessage: PiAgentMessage | null;
};

export type PiChatAction =
  | {
      messages: readonly PiAgentMessage[];
      sessionFile: string;
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

function readMessageTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (!isRecord(part)) {
        return [];
      }
      const partType = readStringProperty(part, "type");
      if (partType === "text") {
        return [readStringProperty(part, "text") ?? ""];
      }
      if (partType === "thinking") {
        return [readStringProperty(part, "thinking") ?? ""];
      }
      return [];
    })
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function readToolCallParts(content: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(
    (part): part is Record<string, unknown> =>
      isRecord(part) && readStringProperty(part, "type") === "toolCall",
  );
}

function createMessageId(input: {
  index: number;
  message: PiAgentMessage;
  prefix: string;
}): string {
  const timestamp = input.message.timestamp ?? input.index;
  return `${input.prefix}:${input.message.role}:${timestamp}:${input.index}`;
}

function createToolEntry(input: {
  message: PiAgentMessage;
  messageId: string;
  part: Record<string, unknown>;
  status: "completed" | "streaming";
}): ChatEntry {
  const name = readStringProperty(input.part, "name") ?? "Tool call";
  const args = input.part.arguments;
  return {
    id: `${input.messageId}:tool:${readStringProperty(input.part, "id") ?? name}`,
    kind: "generic-item",
    itemType: "pi-tool-call",
    title: name,
    body: formatUnknownValue(args),
    detailsJson: JSON.stringify(input.part),
    status: input.status,
    turnId: input.messageId,
  };
}

function buildMessageEntries(input: {
  message: PiAgentMessage;
  messageId: string;
  status: "completed" | "streaming";
}): readonly ChatEntry[] {
  if (input.message.role === "user") {
    return [
      {
        id: input.messageId,
        kind: "user-message",
        text: readMessageTextContent(input.message.content),
        turnId: input.messageId,
        status: "completed",
      },
    ];
  }

  if (input.message.role === "assistant") {
    const entries: ChatEntry[] = [];
    const text = readMessageTextContent(input.message.content);
    if (text.length > 0) {
      entries.push({
        id: input.messageId,
        kind: "assistant-message",
        text,
        phase: null,
        status: input.status,
        turnId: input.messageId,
      });
    }
    for (const part of readToolCallParts(input.message.content)) {
      entries.push(
        createToolEntry({
          message: input.message,
          messageId: input.messageId,
          part,
          status: input.status,
        }),
      );
    }
    return entries.length === 0
      ? [
          {
            id: input.messageId,
            kind: "generic-item",
            itemType: "pi-message",
            title: "Pi message",
            body: formatUnknownValue(input.message),
            detailsJson: JSON.stringify(input.message),
            status: input.status,
            turnId: input.messageId,
          },
        ]
      : entries;
  }

  if (input.message.role === "toolResult") {
    return [
      {
        id: input.messageId,
        kind: "generic-item",
        itemType: "pi-tool-result",
        title: readStringProperty(input.message, "toolName") ?? "Tool result",
        body: readMessageTextContent(input.message.content),
        detailsJson: JSON.stringify(input.message),
        status: input.status,
        turnId: input.messageId,
      },
    ];
  }

  return [
    {
      id: input.messageId,
      kind: "generic-item",
      itemType: "pi-message",
      title: input.message.role,
      body: formatUnknownValue(input.message.content),
      detailsJson: JSON.stringify(input.message),
      status: input.status,
      turnId: input.messageId,
    },
  ];
}

function buildEntries(state: Omit<PiChatState, "entries">): readonly ChatEntry[] {
  const entries = state.messages.flatMap((message, index) =>
    buildMessageEntries({
      message,
      messageId: createMessageId({ index, message, prefix: "pi" }),
      status: "completed",
    }),
  );

  if (state.streamingMessage === null) {
    return entries;
  }

  return [
    ...entries,
    ...buildMessageEntries({
      message: state.streamingMessage,
      messageId: createMessageId({
        index: state.messages.length,
        message: state.streamingMessage,
        prefix: "pi-streaming",
      }),
      status: "streaming",
    }),
  ];
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
    pendingTurnId: null,
    sessionFile: null,
    status: null,
    streamingMessage: null,
  };
}

export function reducePiChatState(state: PiChatState, action: PiChatAction): PiChatState {
  if (action.type === "hydrate_messages") {
    return rebuildState({
      ...createInitialPiChatState(),
      messages: action.messages,
      sessionFile: action.sessionFile,
      status: "idle",
    });
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
      pendingTurnId: `pi:user:${timestamp}`,
      sessionFile: action.sessionFile,
      status: "busy",
    });
  }

  if (action.type === "turn_failed") {
    return rebuildState({
      ...state,
      completedErrorMessage: action.errorMessage,
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
      streamingMessage: null,
    });
  }
  if (event.type === "agent_end") {
    return rebuildState({
      ...state,
      pendingTurnId: null,
      status: "idle",
      streamingMessage: null,
    });
  }

  return state;
}

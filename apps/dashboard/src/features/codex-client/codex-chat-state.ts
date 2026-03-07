import type {
  CodexJsonRpcNotification,
  CodexThreadReadTurn,
} from "@mistle/codex-app-server-client";
import { z } from "zod";

import {
  createInitialChatState,
  reduceChatState,
  type ChatAction,
  type ChatHydratedTurn,
  type ChatState,
  type ChatTurnState,
} from "../chat/chat-state.js";
import type {
  ChatAssistantEntry,
  ChatCommandEntry,
  ChatEntry,
  ChatFileChangeEntry,
  ChatGenericItemEntry,
  ChatPlanEntry,
  ChatReasoningEntry,
  ChatUserEntry,
} from "../chat/chat-types.js";

const TurnStartedNotificationSchema = z.object({
  method: z.literal("turn/started"),
  params: z.object({
    turn: z.object({
      id: z.string().min(1),
      status: z.string().min(1),
    }),
  }),
});

const TurnCompletedNotificationSchema = z.object({
  method: z.literal("turn/completed"),
  params: z.object({
    turn: z.object({
      id: z.string().min(1),
      status: z.string().min(1),
      error: z
        .object({
          message: z.string().min(1),
        })
        .nullable()
        .optional(),
    }),
  }),
});

const ItemDeltaNotificationSchema = z.object({
  method: z.string().min(1),
  params: z.looseObject({
    turnId: z.string().min(1),
    itemId: z.string().min(1),
    delta: z.string().optional(),
  }),
});

const ItemLifecycleNotificationSchema = z.object({
  method: z.enum(["item/started", "item/completed"]),
  params: z.looseObject({
    turnId: z.string().min(1),
    item: z.unknown(),
  }),
});

const ThreadReadTextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const ThreadReadUserMessageItemSchema = z.object({
  type: z.literal("userMessage"),
  id: z.string().min(1),
  content: z.array(ThreadReadTextContentSchema),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function serializeUnknown(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function collectTextParts(value: unknown): string {
  const fragments = collectTextFragments(value, 0);
  return fragments.join("");
}

function collectTextFragments(value: unknown, depth: number): string[] {
  if (depth > 5) {
    return [];
  }

  if (typeof value === "string") {
    return value.length === 0 ? [] : [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectTextFragments(entry, depth + 1));
  }

  if (!isRecord(value)) {
    return [];
  }

  const directText = readOptionalString(value, "text");
  if (directText !== null) {
    return [directText];
  }

  const nestedKeys = ["content", "parts", "summary", "summaryParts", "value"];
  return nestedKeys.flatMap((key) => collectTextFragments(value[key], depth + 1));
}

function normalizeReasoningContent(value: unknown): string {
  const text = collectTextParts(value);
  if (text.length > 0) {
    return text;
  }

  const strings = readStringArray(value);
  if (strings.length > 0) {
    return strings.join("\n");
  }

  return serializeUnknown(value) ?? "";
}

function normalizeReasoningSummary(value: unknown): string {
  if (Array.isArray(value) && value.length === 0) {
    return "";
  }

  const text = collectTextParts(value);
  if (text.length > 0) {
    return text;
  }

  const strings = readStringArray(value);
  if (strings.length > 0) {
    return strings.join("\n");
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
}

function parseFileChangeList(value: unknown): readonly {
  path: string;
  kind: string | null;
  diff: string | null;
}[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const changes: {
    path: string;
    kind: string | null;
    diff: string | null;
  }[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const path =
      readOptionalString(entry, "path") ??
      readOptionalString(entry, "filePath") ??
      readOptionalString(entry, "targetPath");
    if (path === null) {
      continue;
    }

    changes.push({
      path,
      kind: readOptionalString(entry, "kind") ?? readOptionalString(entry, "status"),
      diff:
        readOptionalString(entry, "diff") ??
        readOptionalString(entry, "patch") ??
        readOptionalString(entry, "unifiedDiff"),
    });
  }

  return changes;
}

function resolveGenericItemTitle(itemType: string): string {
  const Titles: Record<string, string> = {
    dynamicToolCall: "Dynamic Tool Call",
    mcpToolCall: "MCP Tool Call",
    collabToolCall: "Collab Tool Call",
    webSearch: "Web Search",
    imageView: "Image View",
    enteredReviewMode: "Entered Review Mode",
    exitedReviewMode: "Exited Review Mode",
    contextCompaction: "Context Compaction",
  };

  return Titles[itemType] ?? itemType;
}

function createGenericItemEntry(input: {
  id: string;
  itemType: string;
  item: Record<string, unknown>;
  turnId: string;
  status: "streaming" | "completed";
}): ChatGenericItemEntry {
  const body =
    readOptionalString(input.item, "title") ??
    readOptionalString(input.item, "text") ??
    readOptionalString(input.item, "name") ??
    readOptionalString(input.item, "query") ??
    readOptionalString(input.item, "url") ??
    readOptionalString(input.item, "status");

  return {
    id: input.id,
    turnId: input.turnId,
    kind: "generic-item",
    itemType: input.itemType,
    title: resolveGenericItemTitle(input.itemType),
    body,
    detailsJson: serializeUnknown(input.item),
    status: input.status,
  };
}

function mapItemToChatEntries(input: {
  turnId: string;
  item: unknown;
  status: "streaming" | "completed";
}): readonly ChatEntry[] {
  if (!isRecord(input.item)) {
    return [];
  }

  const itemType = readOptionalString(input.item, "type");
  const itemId = readOptionalString(input.item, "id");
  if (itemType === null || itemId === null) {
    return [];
  }

  if (itemType === "userMessage") {
    return [];
  }

  if (itemType === "agentMessage") {
    const text = readOptionalString(input.item, "text") ?? collectTextParts(input.item["content"]);
    if (text.length === 0) {
      return [];
    }

    return [
      {
        id: itemId,
        turnId: input.turnId,
        kind: "assistant-message",
        text,
        phase: readOptionalString(input.item, "phase"),
        status: input.status,
      } satisfies ChatAssistantEntry,
    ];
  }

  if (itemType === "reasoning") {
    const entries: ChatEntry[] = [];
    const summary = normalizeReasoningSummary(input.item["summary"]).trim();
    if (summary.length > 0) {
      entries.push({
        id: itemId,
        turnId: input.turnId,
        kind: "reasoning",
        summary,
        source: "summary",
        status: input.status,
      } satisfies ChatReasoningEntry);
    }

    const content = normalizeReasoningContent(input.item["content"]);
    if (content.trim().length > 0) {
      entries.push({
        id: `${itemId}:content`,
        turnId: input.turnId,
        kind: "reasoning",
        summary: content,
        source: "content",
        status: input.status,
      } satisfies ChatReasoningEntry);
    }

    return entries;
  }

  if (itemType === "plan") {
    const text =
      readOptionalString(input.item, "text") ??
      collectTextParts(input.item["content"]) ??
      serializeUnknown(input.item["plan"]) ??
      "";
    if (text.length === 0) {
      return [];
    }

    return [
      {
        id: itemId,
        turnId: input.turnId,
        kind: "plan",
        text,
        status: input.status,
      } satisfies ChatPlanEntry,
    ];
  }

  if (itemType === "commandExecution") {
    return [
      {
        id: itemId,
        turnId: input.turnId,
        kind: "command-execution",
        command: readOptionalString(input.item, "command"),
        output:
          readOptionalString(input.item, "aggregatedOutput") ??
          readOptionalString(input.item, "output"),
        cwd: readOptionalString(input.item, "cwd"),
        exitCode: readOptionalNumber(input.item, "exitCode"),
        commandStatus: readOptionalString(input.item, "status"),
        reason: readOptionalString(input.item, "reason"),
        status: input.status,
      } satisfies ChatCommandEntry,
    ];
  }

  if (itemType === "fileChange") {
    return [
      {
        id: itemId,
        turnId: input.turnId,
        kind: "file-change",
        changes: parseFileChangeList(input.item["changes"]),
        output:
          readOptionalString(input.item, "aggregatedOutput") ??
          readOptionalString(input.item, "output"),
        fileChangeStatus: readOptionalString(input.item, "status"),
        status: input.status,
      } satisfies ChatFileChangeEntry,
    ];
  }

  return [
    createGenericItemEntry({
      id: itemId,
      itemType,
      item: input.item,
      turnId: input.turnId,
      status: input.status,
    }),
  ];
}

function mapThreadReadTurnToChatTurn(turn: CodexThreadReadTurn): ChatHydratedTurn {
  const entries: ChatEntry[] = [];

  for (const item of turn.items) {
    const userMessageItem = ThreadReadUserMessageItemSchema.safeParse(item);
    if (userMessageItem.success) {
      entries.push({
        id: userMessageItem.data.id,
        turnId: turn.id,
        kind: "user-message",
        text: userMessageItem.data.content.map((contentItem) => contentItem.text).join(""),
        status: "completed",
      });
      continue;
    }

    entries.push(...mapItemToChatEntries({ turnId: turn.id, item, status: "completed" }));
  }

  return {
    id: turn.id,
    status: turn.status,
    completedStatus:
      turn.status === "completed" ||
      turn.status === "failed" ||
      turn.status === "cancelled" ||
      turn.status === "interrupted"
        ? turn.status
        : null,
    completedErrorMessage: null,
    entries,
  };
}

function mapItemLifecycleNotificationToChatActions(
  notification: CodexJsonRpcNotification,
): readonly ChatAction[] {
  const parsed = ItemLifecycleNotificationSchema.safeParse(notification);
  if (!parsed.success) {
    return [];
  }

  const entries = mapItemToChatEntries({
    turnId: parsed.data.params.turnId,
    item: parsed.data.params.item,
    status: parsed.data.method === "item/completed" ? "completed" : "streaming",
  });

  const actions: ChatAction[] = [];
  for (const entry of entries) {
    if (entry.kind === "assistant-message") {
      actions.push({
        type: "assistant_message_completed",
        turnId: entry.turnId,
        itemId: entry.id,
        text: entry.text,
        phase: entry.phase,
      });
      continue;
    }

    if (entry.kind === "plan") {
      if (parsed.data.method === "item/started") {
        actions.push({
          type: "plan_delta",
          turnId: entry.turnId,
          itemId: entry.id,
          delta: entry.text,
        });
      } else {
        actions.push({
          type: "plan_completed",
          turnId: entry.turnId,
          itemId: entry.id,
          text: entry.text,
        });
      }
      continue;
    }

    if (entry.kind === "reasoning") {
      if (parsed.data.method === "item/started") {
        actions.push({
          type: "reasoning_delta",
          turnId: entry.turnId,
          itemId: entry.id,
          delta: entry.summary,
          source: entry.source,
        });
      } else {
        actions.push({
          type: "reasoning_completed",
          turnId: entry.turnId,
          itemId: entry.id,
          text: entry.summary,
          source: entry.source,
        });
      }
      continue;
    }

    if (entry.kind === "command-execution") {
      if (parsed.data.method === "item/started") {
        actions.push({
          type: "command_started",
          turnId: entry.turnId,
          itemId: entry.id,
          command: entry.command,
          cwd: entry.cwd,
          reason: entry.reason,
        });
        continue;
      }

      actions.push({
        type: "command_completed",
        turnId: entry.turnId,
        itemId: entry.id,
        command: entry.command,
        output: entry.output,
        cwd: entry.cwd,
        exitCode: entry.exitCode,
        commandStatus: entry.commandStatus,
        reason: entry.reason,
      });
      continue;
    }

    if (entry.kind === "file-change") {
      if (parsed.data.method === "item/started") {
        actions.push({
          type: "file_change_started",
          turnId: entry.turnId,
          itemId: entry.id,
          changes: entry.changes,
        });
        continue;
      }

      actions.push({
        type: "file_change_completed",
        turnId: entry.turnId,
        itemId: entry.id,
        changes: entry.changes,
        output: entry.output,
        fileChangeStatus: entry.fileChangeStatus,
      });
      continue;
    }

    if (entry.kind === "generic-item") {
      actions.push({
        type: "generic_item_upserted",
        entry,
      });
    }
  }

  return actions;
}

function mapNotificationToChatActions(
  notification: CodexJsonRpcNotification,
): readonly ChatAction[] {
  const turnStartedNotification = TurnStartedNotificationSchema.safeParse(notification);
  if (turnStartedNotification.success) {
    return [
      {
        type: "turn_status_updated",
        turnId: turnStartedNotification.data.params.turn.id,
        status: turnStartedNotification.data.params.turn.status,
      },
    ];
  }

  const itemDeltaNotification = ItemDeltaNotificationSchema.safeParse(notification);
  if (itemDeltaNotification.success) {
    if (itemDeltaNotification.data.method === "item/agentMessage/delta") {
      return [
        {
          type: "assistant_message_delta",
          turnId: itemDeltaNotification.data.params.turnId,
          itemId: itemDeltaNotification.data.params.itemId,
          delta: itemDeltaNotification.data.params.delta ?? "",
        },
      ];
    }

    if (itemDeltaNotification.data.method === "item/plan/delta") {
      return [
        {
          type: "plan_delta",
          turnId: itemDeltaNotification.data.params.turnId,
          itemId: itemDeltaNotification.data.params.itemId,
          delta: itemDeltaNotification.data.params.delta ?? "",
        },
      ];
    }

    if (itemDeltaNotification.data.method === "item/reasoning/summaryTextDelta") {
      return [
        {
          type: "reasoning_delta",
          turnId: itemDeltaNotification.data.params.turnId,
          itemId: itemDeltaNotification.data.params.itemId,
          delta: itemDeltaNotification.data.params.delta ?? "",
          source: "summary",
        },
      ];
    }

    if (itemDeltaNotification.data.method === "item/reasoning/summaryPartAdded") {
      return [
        {
          type: "reasoning_part_added",
          turnId: itemDeltaNotification.data.params.turnId,
          itemId: itemDeltaNotification.data.params.itemId,
        },
      ];
    }

    if (itemDeltaNotification.data.method === "item/reasoning/textDelta") {
      return [
        {
          type: "reasoning_delta",
          turnId: itemDeltaNotification.data.params.turnId,
          itemId: `${itemDeltaNotification.data.params.itemId}:content`,
          delta: itemDeltaNotification.data.params.delta ?? "",
          source: "content",
        },
      ];
    }

    if (itemDeltaNotification.data.method === "item/commandExecution/outputDelta") {
      return [
        {
          type: "command_output_delta",
          turnId: itemDeltaNotification.data.params.turnId,
          itemId: itemDeltaNotification.data.params.itemId,
          delta: itemDeltaNotification.data.params.delta ?? "",
        },
      ];
    }

    if (itemDeltaNotification.data.method === "item/fileChange/outputDelta") {
      return [
        {
          type: "file_change_output_delta",
          turnId: itemDeltaNotification.data.params.turnId,
          itemId: itemDeltaNotification.data.params.itemId,
          delta: itemDeltaNotification.data.params.delta ?? "",
        },
      ];
    }
  }

  const lifecycleActions = mapItemLifecycleNotificationToChatActions(notification);
  if (lifecycleActions.length > 0) {
    return lifecycleActions;
  }

  const turnCompletedNotification = TurnCompletedNotificationSchema.safeParse(notification);
  if (turnCompletedNotification.success) {
    return [
      {
        type: "turn_completed",
        turnId: turnCompletedNotification.data.params.turn.id,
        status: turnCompletedNotification.data.params.turn.status,
        errorMessage: turnCompletedNotification.data.params.turn.error?.message ?? null,
      },
    ];
  }

  return [];
}

export type CodexChatUserEntry = ChatUserEntry;
export type CodexChatAssistantEntry = ChatAssistantEntry;
export type CodexChatCommandEntry = ChatCommandEntry;
export type CodexChatReasoningEntry = ChatReasoningEntry;
export type CodexChatEntry = ChatEntry;
export type CodexChatTurnState = ChatTurnState;
export type CodexChatState = ChatState;

export type CodexChatAction =
  | Extract<
      ChatAction,
      | { type: "reset" }
      | { type: "start_turn_requested" }
      | { type: "start_turn_failed" }
      | { type: "turn_started_response" }
    >
  | {
      type: "hydrate_from_thread_read";
      turns: readonly CodexThreadReadTurn[];
    }
  | {
      type: "notification_received";
      notification: CodexJsonRpcNotification;
    };

export function createInitialCodexChatState(): CodexChatState {
  return createInitialChatState();
}

export function reduceCodexChatState(
  state: CodexChatState,
  action: CodexChatAction,
): CodexChatState {
  if (action.type === "hydrate_from_thread_read") {
    return reduceChatState(state, {
      type: "hydrate_turns",
      turns: action.turns.map(mapThreadReadTurnToChatTurn),
    });
  }

  if (action.type === "notification_received") {
    return mapNotificationToChatActions(action.notification).reduce(
      (currentState, chatAction) => reduceChatState(currentState, chatAction),
      state,
    );
  }

  return reduceChatState(state, action);
}

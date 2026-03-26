import type {
  CodexTurnInputLocalImageItem,
  CodexJsonRpcNotification,
  CodexThreadReadTurn,
} from "@mistle/integrations-definitions/openai/agent/client";
import {
  buildCodexTurnTimelineFromNormalized,
  normalizeCodexLocalImageAttachment,
  normalizeCodexThreadItem,
  type CodexTimelineEntry,
  type NormalizedCodexThreadItem,
} from "@mistle/integrations-definitions/openai/agent/client";
import { z } from "zod";

import type {
  ChatAssistantEntry,
  ChatCommandEntry,
  ChatEntry,
  ChatFileChangeEntry,
  ChatGenericItemEntry,
  ChatPlanEntry,
  ChatReasoningEntry,
  ChatSemanticGroupEntry,
  ChatUserEntry,
} from "../../../chat/chat-types.js";
import { parseTurnPlanSnapshot } from "./codex-session-events.js";
import type { CodexTurnPlanSnapshot } from "./codex-session-types.js";

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

const ThreadReadUserMessageItemSchema = z.object({
  type: z.literal("userMessage"),
  id: z.string().min(1),
  content: z.array(
    z.looseObject({
      type: z.string().optional(),
      text: z.string().optional(),
      path: z.string().optional(),
    }),
  ),
});

type CodexRawTurnState = {
  id: string;
  status: string | null;
  completedStatus: string | null;
  completedErrorMessage: string | null;
  planSnapshot: CodexTurnPlanSnapshot | null;
  userEntry: ChatUserEntry | null;
  itemOrder: readonly string[];
  rawItemsById: Readonly<Record<string, unknown>>;
};

export type CodexChatState = {
  activeTurnId: string | null;
  pendingTurnId: string | null;
  status: string | null;
  completedStatus: string | null;
  completedErrorMessage: string | null;
  turnOrder: readonly string[];
  turnsById: Readonly<Record<string, CodexRawTurnState>>;
  entries: readonly ChatEntry[];
};

export type CodexChatAction =
  | {
      type: "reset";
    }
  | {
      type: "start_turn_requested";
      clientTurnId: string;
      prompt: string;
      attachments?: readonly CodexTurnInputLocalImageItem[];
    }
  | {
      type: "start_turn_failed";
      clientTurnId: string;
    }
  | {
      type: "turn_started_response";
      clientTurnId: string;
      turnId: string;
      status: string;
    }
  | {
      type: "hydrate_from_thread_read";
      turns: readonly CodexThreadReadTurn[];
    }
  | {
      type: "notification_received";
      notification: CodexJsonRpcNotification;
    };

const AttachedImagesHeader = "Attached images:";

function splitPromptAndAttachedImagePaths(text: string): {
  attachmentPaths: readonly string[];
  prompt: string;
} {
  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    return {
      attachmentPaths: [],
      prompt: "",
    };
  }

  const headerBlock = `${AttachedImagesHeader}\n`;
  const separatorBlock = `\n\n${headerBlock}`;
  const blockStartIndex = trimmedText.startsWith(headerBlock)
    ? 0
    : trimmedText.lastIndexOf(separatorBlock);

  if (blockStartIndex === -1) {
    return {
      attachmentPaths: [],
      prompt: trimmedText,
    };
  }

  const attachmentSection =
    blockStartIndex === 0 ? trimmedText : trimmedText.slice(blockStartIndex + 2);

  if (!attachmentSection.startsWith(headerBlock)) {
    return {
      attachmentPaths: [],
      prompt: trimmedText,
    };
  }

  const attachmentLines = attachmentSection.slice(headerBlock.length).split("\n");
  if (attachmentLines.length === 0 || attachmentLines.some((line) => !line.startsWith("- "))) {
    return {
      attachmentPaths: [],
      prompt: trimmedText,
    };
  }

  const attachmentPaths = attachmentLines
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);

  if (attachmentPaths.length !== attachmentLines.length) {
    return {
      attachmentPaths: [],
      prompt: trimmedText,
    };
  }

  return {
    attachmentPaths,
    prompt: blockStartIndex === 0 ? "" : trimmedText.slice(0, blockStartIndex).trimEnd(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function createTurnState(turnId: string): CodexRawTurnState {
  return {
    id: turnId,
    status: null,
    completedStatus: null,
    completedErrorMessage: null,
    planSnapshot: null,
    userEntry: null,
    itemOrder: [],
    rawItemsById: {},
  };
}

function ensureTurn(
  turnsById: Readonly<Record<string, CodexRawTurnState>>,
  turnOrder: readonly string[],
  turnId: string,
): { turnsById: Readonly<Record<string, CodexRawTurnState>>; turnOrder: readonly string[] } {
  if (turnsById[turnId] !== undefined) {
    return {
      turnsById,
      turnOrder,
    };
  }

  return {
    turnsById: {
      ...turnsById,
      [turnId]: createTurnState(turnId),
    },
    turnOrder: [...turnOrder, turnId],
  };
}

function isTerminalTurnStatus(status: string | null): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

function buildNormalizedItems(turn: CodexRawTurnState): readonly NormalizedCodexThreadItem[] {
  return turn.itemOrder.flatMap((itemId) => {
    const rawItem = turn.rawItemsById[itemId];
    if (rawItem === undefined) {
      return [];
    }

    return normalizeCodexThreadItem({
      turnId: turn.id,
      item: rawItem,
    }).filter((item) => item.kind !== "user-message");
  });
}

function createGenericEntry(input: {
  id: string;
  turnId: string;
  itemType: string;
  title: string;
  body: string | null;
  detailsJson: string | null;
  status: "streaming" | "completed";
}): ChatGenericItemEntry {
  return {
    id: input.id,
    turnId: input.turnId,
    kind: "generic-item",
    itemType: input.itemType,
    title: input.title,
    body: input.body,
    detailsJson: input.detailsJson,
    status: input.status,
  };
}

function isChatPlanStepStatus(value: string): value is "pending" | "inProgress" | "completed" {
  return value === "pending" || value === "inProgress" || value === "completed";
}

function buildPlanEntry(input: {
  id: string;
  turnId: string;
  text: string | null;
  status: "streaming" | "completed";
  planSnapshot: CodexTurnPlanSnapshot | null;
}): ChatPlanEntry {
  if (input.planSnapshot === null) {
    return {
      id: input.id,
      turnId: input.turnId,
      kind: "plan",
      text: input.text,
      explanation: null,
      steps: null,
      status: input.status,
    };
  }

  const steps = input.planSnapshot.steps.map((step) => {
    if (!isChatPlanStepStatus(step.status)) {
      throw new Error(`Unsupported plan step status '${step.status}'.`);
    }

    return {
      step: step.step,
      status: step.status,
    };
  });

  return {
    id: input.id,
    turnId: input.turnId,
    kind: "plan",
    text: input.text,
    explanation: input.planSnapshot.explanation,
    steps,
    status: input.status,
  };
}

function summarizeExploringItem(
  item: Extract<NormalizedCodexThreadItem, { kind: "command-execution" }>,
): {
  label: string;
  detail: string | null;
  sourcePath: string | null;
  detailKind: "plain" | "code";
} {
  const firstAction = item.commandActions[0];
  if (firstAction === undefined) {
    return {
      label: "Command",
      detail: item.command,
      sourcePath: null,
      detailKind: "code",
    };
  }

  if (firstAction.type === "read") {
    return {
      label: "Read",
      detail: firstAction.path ?? firstAction.name,
      sourcePath: firstAction.path ?? firstAction.name,
      detailKind: "code",
    };
  }

  if (firstAction.type === "search") {
    return {
      label: "Search",
      detail: firstAction.query ?? firstAction.path ?? item.command,
      sourcePath: null,
      detailKind: "plain",
    };
  }

  if (firstAction.type === "list-files") {
    return {
      label: "List files",
      detail: firstAction.path ?? item.command,
      sourcePath: firstAction.path ?? item.command ?? null,
      detailKind: "code",
    };
  }

  return {
    label: "Command",
    detail: item.command,
    sourcePath: null,
    detailKind: "code",
  };
}

function formatSemanticGroupDetail(input: {
  detail: string | null;
  maxLength: number;
}): string | null {
  if (input.detail === null) {
    return null;
  }

  const normalizedDetail = input.detail.replaceAll(/\s+/g, " ").trim();
  if (normalizedDetail.length === 0) {
    return null;
  }

  if (normalizedDetail.length <= input.maxLength) {
    return normalizedDetail;
  }

  return `${normalizedDetail.slice(0, input.maxLength - 1).trimEnd()}…`;
}

function summarizeFileChangeOutput(
  item: Extract<NormalizedCodexThreadItem, { kind: "file-change" }>,
): string | null {
  const diffs = item.changes
    .filter((change) => change.diff !== null && change.diff.length > 0)
    .map((change) => change.diff);

  if (diffs.length > 0) {
    return diffs.join("\n\n");
  }

  return item.output !== null && item.output.length > 0 ? item.output : null;
}

function getFileChangeLabel(kind: string | null, count: number): string {
  if (count > 1) {
    return "File changes";
  }

  switch (kind) {
    case "add":
    case "added":
      return "Added";
    case "delete":
    case "deleted":
      return "Deleted";
    case "rename":
    case "renamed":
      return "Renamed";
    case "update":
    case "updated":
    case "modify":
    case "modified":
      return "Updated";
    default:
      return "File change";
  }
}

function summarizeSemanticGroupItem(item: NormalizedCodexThreadItem): {
  sourceKind: "command-execution" | "reasoning" | "file-change" | "web-search" | "tool-call";
  label: string;
  detail: string | null;
  sourcePath: string | null;
  detailKind: "plain" | "code";
  output: string | null;
} {
  if (item.kind === "command-execution") {
    const exploringSummary = summarizeExploringItem(item);
    const hasExploringActions =
      item.commandActions.length > 0 &&
      item.commandActions.every(
        (action) =>
          action.type === "read" || action.type === "list-files" || action.type === "search",
      );
    if (hasExploringActions) {
      return {
        sourceKind: "command-execution",
        label: exploringSummary.label,
        detail: formatSemanticGroupDetail({
          detail: exploringSummary.detail,
          maxLength: 72,
        }),
        sourcePath: exploringSummary.sourcePath,
        detailKind: exploringSummary.detailKind,
        output: item.output,
      };
    }

    return {
      sourceKind: "command-execution",
      label: "Command",
      detail: formatSemanticGroupDetail({
        detail: item.command ?? item.reason,
        maxLength: 80,
      }),
      sourcePath: null,
      detailKind: "code",
      output: item.output,
    };
  }

  if (item.kind === "reasoning") {
    return {
      sourceKind: "reasoning",
      label: "Thought",
      detail: formatSemanticGroupDetail({
        detail: item.text,
        maxLength: 88,
      }),
      sourcePath: null,
      detailKind: "plain",
      output: null,
    };
  }

  if (item.kind === "file-change") {
    const paths = item.changes.map((change) => change.path);
    return {
      sourceKind: "file-change",
      label: getFileChangeLabel(item.changes[0]?.kind ?? null, item.changes.length),
      detail: formatSemanticGroupDetail({
        detail: paths.length === 0 ? null : paths.join(", "),
        maxLength: 88,
      }),
      sourcePath: null,
      detailKind: "code",
      output: summarizeFileChangeOutput(item),
    };
  }

  if (item.kind === "web-search") {
    return {
      sourceKind: "web-search",
      label: "Web search",
      detail: formatSemanticGroupDetail({
        detail: item.query,
        maxLength: 72,
      }),
      sourcePath: null,
      detailKind: "plain",
      output: item.detailsJson,
    };
  }

  if (item.kind === "tool-call") {
    return {
      sourceKind: "tool-call",
      label: item.title,
      detail: formatSemanticGroupDetail({
        detail: item.body ?? item.toolType,
        maxLength: 72,
      }),
      sourcePath: null,
      detailKind: "plain",
      output: item.detailsJson,
    };
  }

  return {
    sourceKind: "tool-call",
    label: item.kind,
    detail: null,
    sourcePath: null,
    detailKind: "plain",
    output: null,
  };
}

function mapTimelineEntryToChatEntries(entry: CodexTimelineEntry): readonly ChatEntry[] {
  if (!("item" in entry)) {
    return [
      {
        id: entry.id,
        turnId: entry.items[0]?.turnId ?? "",
        kind: "semantic-group",
        semanticKind: entry.kind,
        status: entry.status,
        displayKeys: entry.displayKeys,
        counts: entry.counts,
        items: entry.items.map((item) => {
          const summary = summarizeSemanticGroupItem(item);

          return {
            id: item.id,
            sourceKind: summary.sourceKind,
            label: summary.label,
            detail: summary.detail,
            ...(summary.sourcePath === null ? {} : { sourcePath: summary.sourcePath }),
            detailKind: summary.detailKind,
            command: item.kind === "command-execution" ? item.command : null,
            output: summary.output,
            status: "status" in item ? item.status : "completed",
          };
        }),
      } satisfies ChatSemanticGroupEntry,
    ];
  }

  const item = entry.item;
  if (item.kind === "assistant-message") {
    return [
      {
        id: item.id,
        turnId: item.turnId,
        kind: "assistant-message",
        text: item.text,
        phase: item.phase,
        status: item.status,
      } satisfies ChatAssistantEntry,
    ];
  }

  if (item.kind === "plan") {
    return [
      buildPlanEntry({
        id: item.id,
        turnId: item.turnId,
        text: item.text,
        status: item.status,
        planSnapshot: null,
      }),
    ];
  }

  if (item.kind === "reasoning") {
    return [
      {
        id: item.id,
        turnId: item.turnId,
        kind: "reasoning",
        summary: item.text,
        source: item.source,
        status: item.status,
      } satisfies ChatReasoningEntry,
    ];
  }

  if (item.kind === "command-execution") {
    return [
      {
        id: item.id,
        turnId: item.turnId,
        kind: "command-execution",
        command: item.command,
        output: item.output,
        cwd: item.cwd,
        exitCode: item.exitCode,
        commandStatus: item.commandStatus,
        reason: item.reason,
        status: item.status,
      } satisfies ChatCommandEntry,
    ];
  }

  if (item.kind === "file-change") {
    return [
      {
        id: item.id,
        turnId: item.turnId,
        kind: "file-change",
        changes: item.changes,
        output: item.output,
        fileChangeStatus: item.fileChangeStatus,
        status: item.status,
      } satisfies ChatFileChangeEntry,
    ];
  }

  if (item.kind === "tool-call") {
    return [
      createGenericEntry({
        id: item.id,
        turnId: item.turnId,
        itemType:
          item.toolType === "dynamic"
            ? "dynamicToolCall"
            : item.toolType === "mcp"
              ? "mcpToolCall"
              : "collabAgentToolCall",
        title:
          item.toolType === "dynamic"
            ? "Dynamic Tool Call"
            : item.toolType === "mcp"
              ? "MCP Tool Call"
              : "Collab Tool Call",
        body: item.body ?? item.title,
        detailsJson: item.detailsJson,
        status: item.status,
      }),
    ];
  }

  if (item.kind === "web-search") {
    return [
      createGenericEntry({
        id: item.id,
        turnId: item.turnId,
        itemType: "web-search",
        title: entry.status === "streaming" ? "Searching the web" : "Searched the web",
        body: item.query,
        detailsJson: item.detailsJson,
        status: item.status,
      }),
    ];
  }

  if (item.kind === "generic-item") {
    return [
      createGenericEntry({
        id: item.id,
        turnId: item.turnId,
        itemType: item.itemType,
        title: item.title,
        body: item.body,
        detailsJson: item.detailsJson,
        status: item.status,
      }),
    ];
  }

  return [];
}

function buildEntries(input: {
  turnOrder: readonly string[];
  turnsById: Readonly<Record<string, CodexRawTurnState>>;
}): readonly ChatEntry[] {
  const entries: ChatEntry[] = [];

  for (const turnId of input.turnOrder) {
    const turn = input.turnsById[turnId];
    if (turn === undefined) {
      continue;
    }

    if (turn.userEntry !== null) {
      entries.push(turn.userEntry);
    }

    const timeline = buildCodexTurnTimelineFromNormalized({
      turnId,
      items: buildNormalizedItems(turn),
    });
    for (const timelineEntry of timeline) {
      entries.push(...mapTimelineEntryToChatEntries(timelineEntry));
    }

    if (turn.planSnapshot !== null) {
      entries.push(
        buildPlanEntry({
          id: `${turn.id}:plan-snapshot`,
          turnId: turn.id,
          text: null,
          status: turn.status === "inProgress" ? "streaming" : "completed",
          planSnapshot: turn.planSnapshot,
        }),
      );
    }
  }

  return entries;
}

function buildState(input: {
  pendingTurnId: string | null;
  turnOrder: readonly string[];
  turnsById: Readonly<Record<string, CodexRawTurnState>>;
}): CodexChatState {
  const activeTurnId = input.turnOrder.at(-1) ?? null;
  const activeTurn = activeTurnId === null ? null : (input.turnsById[activeTurnId] ?? null);

  return {
    activeTurnId,
    pendingTurnId: input.pendingTurnId,
    status: activeTurn?.status ?? null,
    completedStatus:
      activeTurn === null
        ? null
        : (activeTurn.completedStatus ??
          (isTerminalTurnStatus(activeTurn.status) ? activeTurn.status : null)),
    completedErrorMessage: activeTurn?.completedErrorMessage ?? null,
    turnOrder: input.turnOrder,
    turnsById: input.turnsById,
    entries: buildEntries({
      turnOrder: input.turnOrder,
      turnsById: input.turnsById,
    }),
  };
}

function buildUserEntry(
  turnId: string,
  text: string,
  attachments: NonNullable<ChatUserEntry["attachments"]> = [],
  id?: string,
): ChatUserEntry {
  return {
    id: id ?? `user:${turnId}`,
    turnId,
    kind: "user-message",
    text,
    ...(attachments.length === 0 ? {} : { attachments }),
    status: "completed",
  };
}

function buildChatUserAttachments(
  attachments: readonly CodexTurnInputLocalImageItem[] | undefined,
): NonNullable<ChatUserEntry["attachments"]> {
  return (attachments ?? []).map((attachment) => normalizeCodexLocalImageAttachment(attachment));
}

function buildChatUserAttachmentsFromPaths(
  attachmentPaths: readonly string[],
): NonNullable<ChatUserEntry["attachments"]> {
  return attachmentPaths.map((path) => normalizeCodexLocalImageAttachment({ path }));
}

function mergeRawItem(existing: unknown, incoming: unknown): unknown {
  if (!isRecord(existing) || !isRecord(incoming)) {
    return incoming;
  }

  return {
    ...existing,
    ...incoming,
  };
}

function updateRawItemTextField(
  state: CodexChatState,
  input: {
    turnId: string;
    itemId: string;
    itemType: string;
    field: "text" | "summary" | "content" | "aggregatedOutput" | "output";
    delta: string;
  },
): CodexChatState {
  const ensured = ensureTurn(state.turnsById, state.turnOrder, input.turnId);
  const turn = ensured.turnsById[input.turnId] ?? createTurnState(input.turnId);
  const existingRawItem = turn.rawItemsById[input.itemId];
  const nextRawItem = isRecord(existingRawItem)
    ? {
        ...existingRawItem,
        type: input.itemType,
        id: input.itemId,
        status:
          typeof existingRawItem["status"] === "string" ? existingRawItem["status"] : "inProgress",
        [input.field]:
          typeof existingRawItem[input.field] === "string"
            ? `${existingRawItem[input.field]}${input.delta}`
            : input.delta,
      }
    : {
        type: input.itemType,
        id: input.itemId,
        status: "inProgress",
        [input.field]: input.delta,
      };

  const nextItemOrder = turn.itemOrder.includes(input.itemId)
    ? turn.itemOrder
    : [...turn.itemOrder, input.itemId];

  return buildState({
    pendingTurnId: state.pendingTurnId,
    turnOrder: ensured.turnOrder,
    turnsById: {
      ...ensured.turnsById,
      [input.turnId]: {
        ...turn,
        itemOrder: nextItemOrder,
        rawItemsById: {
          ...turn.rawItemsById,
          [input.itemId]: nextRawItem,
        },
      },
    },
  });
}

function upsertLifecycleItem(
  state: CodexChatState,
  input: {
    turnId: string;
    item: unknown;
    method: "item/started" | "item/completed";
  },
): CodexChatState {
  if (!isRecord(input.item)) {
    throw new Error(`Lifecycle item must be an object. Payload: ${JSON.stringify(input.item)}`);
  }

  const itemId = readOptionalString(input.item, "id");
  const itemType = readOptionalString(input.item, "type");
  if (itemId === null || itemType === null) {
    throw new Error(`Lifecycle item is missing id or type. Payload: ${JSON.stringify(input.item)}`);
  }

  const ensured = ensureTurn(state.turnsById, state.turnOrder, input.turnId);
  const turn = ensured.turnsById[input.turnId] ?? createTurnState(input.turnId);
  if (itemType === "userMessage") {
    return state;
  }

  const lifecycleItem = !("status" in input.item)
    ? {
        ...input.item,
        status: input.method === "item/started" ? "inProgress" : "completed",
      }
    : input.item;

  return buildState({
    pendingTurnId: state.pendingTurnId,
    turnOrder: ensured.turnOrder,
    turnsById: {
      ...ensured.turnsById,
      [input.turnId]: {
        ...turn,
        itemOrder: turn.itemOrder.includes(itemId) ? turn.itemOrder : [...turn.itemOrder, itemId],
        rawItemsById: {
          ...turn.rawItemsById,
          [itemId]: mergeRawItem(turn.rawItemsById[itemId], lifecycleItem),
        },
      },
    },
  });
}

function hydrateTurns(turns: readonly CodexThreadReadTurn[]): CodexChatState {
  const turnsById: Record<string, CodexRawTurnState> = {};
  const turnOrder: string[] = [];

  for (const turn of turns) {
    turnOrder.push(turn.id);
    let userEntry: ChatUserEntry | null = null;
    const itemOrder: string[] = [];
    const rawItemsById: Record<string, unknown> = {};

    for (const item of turn.items) {
      const parsedUserMessage = ThreadReadUserMessageItemSchema.safeParse(item);
      if (parsedUserMessage.success) {
        const parsedText = parsedUserMessage.data.content
          .map((contentItem) => contentItem.text ?? "")
          .join("");
        const parsedAttachmentPaths = splitPromptAndAttachedImagePaths(parsedText);
        userEntry = buildUserEntry(
          turn.id,
          parsedAttachmentPaths.prompt,
          [
            ...parsedUserMessage.data.content.flatMap((contentItem) => {
              if (contentItem.type !== "localImage" || contentItem.path === undefined) {
                return [];
              }

              return [normalizeCodexLocalImageAttachment({ path: contentItem.path })];
            }),
            ...buildChatUserAttachmentsFromPaths(parsedAttachmentPaths.attachmentPaths),
          ],
          parsedUserMessage.data.id,
        );
        continue;
      }

      if (!isRecord(item)) {
        continue;
      }

      const itemId = readOptionalString(item, "id");
      if (itemId === null) {
        continue;
      }

      itemOrder.push(itemId);
      rawItemsById[itemId] = item;
    }

    turnsById[turn.id] = {
      id: turn.id,
      status: turn.status,
      completedStatus: isTerminalTurnStatus(turn.status) ? turn.status : null,
      completedErrorMessage: null,
      planSnapshot: null,
      userEntry,
      itemOrder,
      rawItemsById,
    };
  }

  return buildState({
    pendingTurnId: null,
    turnOrder,
    turnsById,
  });
}

export function createInitialCodexChatState(): CodexChatState {
  return buildState({
    pendingTurnId: null,
    turnOrder: [],
    turnsById: {},
  });
}

export function reduceCodexChatState(
  state: CodexChatState,
  action: CodexChatAction,
): CodexChatState {
  if (action.type === "reset") {
    return createInitialCodexChatState();
  }

  if (action.type === "start_turn_requested") {
    return buildState({
      pendingTurnId: action.clientTurnId,
      turnOrder: [...state.turnOrder, action.clientTurnId],
      turnsById: {
        ...state.turnsById,
        [action.clientTurnId]: {
          id: action.clientTurnId,
          status: "starting",
          completedStatus: null,
          completedErrorMessage: null,
          planSnapshot: null,
          userEntry: buildUserEntry(
            action.clientTurnId,
            action.prompt,
            buildChatUserAttachments(action.attachments),
          ),
          itemOrder: [],
          rawItemsById: {},
        },
      },
    });
  }

  if (action.type === "start_turn_failed") {
    const nextTurnsById: Record<string, CodexRawTurnState> = {};
    for (const [turnId, turn] of Object.entries(state.turnsById)) {
      if (turnId !== action.clientTurnId) {
        nextTurnsById[turnId] = turn;
      }
    }

    return buildState({
      pendingTurnId: null,
      turnOrder: state.turnOrder.filter((turnId) => turnId !== action.clientTurnId),
      turnsById: nextTurnsById,
    });
  }

  if (action.type === "turn_started_response") {
    const pendingTurn =
      state.turnsById[action.clientTurnId] ?? createTurnState(action.clientTurnId);
    const existingTurn = state.turnsById[action.turnId] ?? createTurnState(action.turnId);
    const nextTurnsById: Record<string, CodexRawTurnState> = {};
    for (const [turnId, turn] of Object.entries(state.turnsById)) {
      if (turnId !== action.clientTurnId && turnId !== action.turnId) {
        nextTurnsById[turnId] = turn;
      }
    }

    nextTurnsById[action.turnId] = {
      ...existingTurn,
      id: action.turnId,
      status: action.status,
      completedStatus: null,
      completedErrorMessage: null,
      planSnapshot: pendingTurn.planSnapshot ?? existingTurn.planSnapshot,
      userEntry:
        pendingTurn.userEntry === null
          ? existingTurn.userEntry
          : {
              ...pendingTurn.userEntry,
              id: `user:${action.turnId}`,
              turnId: action.turnId,
            },
      itemOrder: [...pendingTurn.itemOrder, ...existingTurn.itemOrder].filter(
        (itemId, index, itemOrder) => itemOrder.indexOf(itemId) === index,
      ),
      rawItemsById: {
        ...pendingTurn.rawItemsById,
        ...existingTurn.rawItemsById,
      },
    };

    return buildState({
      pendingTurnId: null,
      turnOrder: state.turnOrder
        .map((turnId) => (turnId === action.clientTurnId ? action.turnId : turnId))
        .filter((turnId, index, turnOrder) => turnOrder.indexOf(turnId) === index),
      turnsById: nextTurnsById,
    });
  }

  if (action.type === "hydrate_from_thread_read") {
    return hydrateTurns(action.turns);
  }

  const turnStartedNotification = TurnStartedNotificationSchema.safeParse(action.notification);
  if (turnStartedNotification.success) {
    const ensured = ensureTurn(
      state.turnsById,
      state.turnOrder,
      turnStartedNotification.data.params.turn.id,
    );
    const turnId = turnStartedNotification.data.params.turn.id;
    const turn = ensured.turnsById[turnId] ?? createTurnState(turnId);
    return buildState({
      pendingTurnId: state.pendingTurnId,
      turnOrder: ensured.turnOrder,
      turnsById: {
        ...ensured.turnsById,
        [turnId]: {
          ...turn,
          status: turnStartedNotification.data.params.turn.status,
        },
      },
    });
  }

  const itemDeltaNotification = ItemDeltaNotificationSchema.safeParse(action.notification);
  if (itemDeltaNotification.success) {
    const delta = itemDeltaNotification.data.params.delta ?? "";
    if (itemDeltaNotification.data.method === "item/agentMessage/delta") {
      return updateRawItemTextField(state, {
        turnId: itemDeltaNotification.data.params.turnId,
        itemId: itemDeltaNotification.data.params.itemId,
        itemType: "agentMessage",
        field: "text",
        delta,
      });
    }

    if (itemDeltaNotification.data.method === "item/plan/delta") {
      return updateRawItemTextField(state, {
        turnId: itemDeltaNotification.data.params.turnId,
        itemId: itemDeltaNotification.data.params.itemId,
        itemType: "plan",
        field: "text",
        delta,
      });
    }

    if (itemDeltaNotification.data.method === "item/reasoning/summaryTextDelta") {
      return updateRawItemTextField(state, {
        turnId: itemDeltaNotification.data.params.turnId,
        itemId: itemDeltaNotification.data.params.itemId,
        itemType: "reasoning",
        field: "summary",
        delta,
      });
    }

    if (itemDeltaNotification.data.method === "item/reasoning/summaryPartAdded") {
      return updateRawItemTextField(state, {
        turnId: itemDeltaNotification.data.params.turnId,
        itemId: itemDeltaNotification.data.params.itemId,
        itemType: "reasoning",
        field: "summary",
        delta: "\n\n",
      });
    }

    if (itemDeltaNotification.data.method === "item/reasoning/textDelta") {
      return updateRawItemTextField(state, {
        turnId: itemDeltaNotification.data.params.turnId,
        itemId: itemDeltaNotification.data.params.itemId,
        itemType: "reasoning",
        field: "content",
        delta,
      });
    }

    if (itemDeltaNotification.data.method === "item/commandExecution/outputDelta") {
      return updateRawItemTextField(state, {
        turnId: itemDeltaNotification.data.params.turnId,
        itemId: itemDeltaNotification.data.params.itemId,
        itemType: "commandExecution",
        field: "aggregatedOutput",
        delta,
      });
    }

    if (itemDeltaNotification.data.method === "item/fileChange/outputDelta") {
      return updateRawItemTextField(state, {
        turnId: itemDeltaNotification.data.params.turnId,
        itemId: itemDeltaNotification.data.params.itemId,
        itemType: "fileChange",
        field: "output",
        delta,
      });
    }
  }

  const turnPlanSnapshot = parseTurnPlanSnapshot(action.notification);
  if (turnPlanSnapshot !== null) {
    const ensured = ensureTurn(state.turnsById, state.turnOrder, turnPlanSnapshot.turnId);
    const turn =
      ensured.turnsById[turnPlanSnapshot.turnId] ?? createTurnState(turnPlanSnapshot.turnId);

    return buildState({
      pendingTurnId: state.pendingTurnId,
      turnOrder: ensured.turnOrder,
      turnsById: {
        ...ensured.turnsById,
        [turnPlanSnapshot.turnId]: {
          ...turn,
          planSnapshot: turnPlanSnapshot,
        },
      },
    });
  }

  const lifecycleNotification = ItemLifecycleNotificationSchema.safeParse(action.notification);
  if (lifecycleNotification.success) {
    return upsertLifecycleItem(state, {
      turnId: lifecycleNotification.data.params.turnId,
      item: lifecycleNotification.data.params.item,
      method: lifecycleNotification.data.method,
    });
  }

  const turnCompletedNotification = TurnCompletedNotificationSchema.safeParse(action.notification);
  if (turnCompletedNotification.success) {
    const ensured = ensureTurn(
      state.turnsById,
      state.turnOrder,
      turnCompletedNotification.data.params.turn.id,
    );
    const turnId = turnCompletedNotification.data.params.turn.id;
    const turn = ensured.turnsById[turnId] ?? createTurnState(turnId);
    return buildState({
      pendingTurnId: state.pendingTurnId,
      turnOrder: ensured.turnOrder,
      turnsById: {
        ...ensured.turnsById,
        [turnId]: {
          ...turn,
          status: turnCompletedNotification.data.params.turn.status,
          completedStatus: turnCompletedNotification.data.params.turn.status,
          completedErrorMessage: turnCompletedNotification.data.params.turn.error?.message ?? null,
        },
      },
    });
  }

  return state;
}

export type {
  ChatAssistantEntry as CodexChatAssistantEntry,
  ChatCommandEntry as CodexChatCommandEntry,
  ChatEntry as CodexChatEntry,
  ChatReasoningEntry as CodexChatReasoningEntry,
  ChatUserEntry as CodexChatUserEntry,
};

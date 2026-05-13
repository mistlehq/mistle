import type {
  CodexJsonRpcNotification,
  CodexThreadReadTurn,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import {
  classifyCodexThreadItemSemantics,
  normalizeCodexLocalImageAttachment,
  normalizeCodexThreadItem,
  type NormalizedCodexThreadItem,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { z } from "zod";

import {
  formatSemanticChatDetail,
  projectSemanticChatEntries,
  type SemanticChatProjectionItem,
} from "../../../chat/chat-semantic-projection.js";
import type {
  ChatAssistantEntry,
  ChatAttachment,
  ChatCommandEntry,
  ChatEntry,
  ChatFileChangeEntry,
  ChatGenericItemEntry,
  ChatPlanEntry,
  ChatReasoningEntry,
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

type ClientSteerAnchor =
  | {
      kind: "turn-start";
    }
  | {
      kind: "after-item";
      itemId: string;
    }
  | {
      kind: "after-assistant-text";
      itemId: string;
      text: string;
    };

type ClientSteerEntry = {
  entry: ChatUserEntry;
  requestState: "accepted" | "queued" | "sending";
  anchor: ClientSteerAnchor;
};

type TurnStartSteerEntry = ClientSteerEntry & {
  anchor: Extract<ClientSteerAnchor, { kind: "turn-start" }>;
};

type AfterItemSteerEntry = ClientSteerEntry & {
  anchor: Extract<ClientSteerAnchor, { kind: "after-item" }>;
};

type AfterAssistantTextSteerEntry = ClientSteerEntry & {
  anchor: Extract<ClientSteerAnchor, { kind: "after-assistant-text" }>;
};

type CodexRawTurnState = {
  id: string;
  status: string | null;
  completedStatus: string | null;
  completedErrorMessage: string | null;
  planSnapshot: CodexTurnPlanSnapshot | null;
  userEntry: ChatUserEntry | null;
  clientSteerEntries: readonly ClientSteerEntry[];
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
      type: "turn_started";
      turnId: string;
      status: string;
      prompt: string;
      attachments?: readonly ChatAttachment[];
    }
  | {
      type: "steer_turn_requested";
      entryId: string;
      turnId: string;
      prompt: string;
      attachments?: readonly ChatAttachment[];
    }
  | {
      type: "steer_turn_processed";
      entryId: string;
      turnId: string;
    }
  | {
      type: "steer_turn_sending";
      entryId: string;
      turnId: string;
    }
  | {
      type: "steer_turn_failed";
      entryId: string;
      turnId: string;
    }
  | {
      type: "dismiss_client_user_entry";
      entryId: string;
      turnId: string;
    }
  | {
      type: "hydrate_from_thread_read";
      turns: readonly CodexThreadReadTurn[];
    }
  | {
      type: "notification_received";
      notification: CodexJsonRpcNotification;
    };

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
    clientSteerEntries: [],
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

function buildNormalizedItemsForRawItem(
  turn: CodexRawTurnState,
  rawItemId: string,
): readonly NormalizedCodexThreadItem[] {
  const rawItem = turn.rawItemsById[rawItemId];
  if (rawItem === undefined) {
    return [];
  }

  return normalizeCodexThreadItem({
    turnId: turn.id,
    item: rawItem,
  }).filter((item) => item.kind !== "user-message");
}

function buildRenderedAssistantItemSegment(input: {
  item: Extract<NormalizedCodexThreadItem, { kind: "assistant-message" }>;
  startOffset: number;
  text: string;
}): Extract<NormalizedCodexThreadItem, { kind: "assistant-message" }> {
  return {
    ...input.item,
    id: `${input.item.id}:segment:${input.startOffset}`,
    text: input.text,
  };
}

function mapRenderedItemsToEntries(
  input: {
    turnId: string;
    items: readonly NormalizedCodexThreadItem[];
  } | null,
): readonly ChatEntry[] {
  if (input === null || input.items.length === 0) {
    return [];
  }

  return projectSemanticChatEntries(
    input.items.flatMap((item) => mapNormalizedItemToProjection(item)),
  );
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
        detail: formatSemanticChatDetail({
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
      detail: formatSemanticChatDetail({
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
      detail: formatSemanticChatDetail({
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
      detail: formatSemanticChatDetail({
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
      detail: formatSemanticChatDetail({
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
      detail: formatSemanticChatDetail({
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

function mapNormalizedItemToProjection(
  item: NormalizedCodexThreadItem,
): readonly SemanticChatProjectionItem[] {
  const classified = classifyCodexThreadItemSemantics(item);
  if (classified.semanticKind !== "generic") {
    const summary = summarizeSemanticGroupItem(item);
    return [
      {
        kind: "semantic",
        id: item.id,
        turnId: item.turnId,
        semanticKind: classified.semanticKind,
        status: classified.status,
        displayKeys: classified.displayKeys,
        counts: classified.summaryCounts,
        sourceKind: summary.sourceKind,
        label: summary.label,
        detail: summary.detail,
        sourcePath: summary.sourcePath,
        detailKind: summary.detailKind,
        command: item.kind === "command-execution" ? item.command : null,
        output: summary.output,
      },
    ];
  }

  if (item.kind === "assistant-message") {
    return [
      {
        kind: "standalone",
        entry: {
          id: item.id,
          turnId: item.turnId,
          kind: "assistant-message",
          text: item.text,
          phase: item.phase,
          status: item.status,
        } satisfies ChatAssistantEntry,
      },
    ];
  }

  if (item.kind === "plan") {
    return [
      {
        kind: "standalone",
        entry: buildPlanEntry({
          id: item.id,
          turnId: item.turnId,
          text: item.text,
          status: item.status,
          planSnapshot: null,
        }),
      },
    ];
  }

  if (item.kind === "reasoning") {
    return [
      {
        kind: "standalone",
        entry: {
          id: item.id,
          turnId: item.turnId,
          kind: "reasoning",
          summary: item.text,
          source: item.source,
          status: item.status,
        } satisfies ChatReasoningEntry,
      },
    ];
  }

  if (item.kind === "command-execution") {
    return [
      {
        kind: "standalone",
        entry: {
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
      },
    ];
  }

  if (item.kind === "file-change") {
    return [
      {
        kind: "standalone",
        entry: {
          id: item.id,
          turnId: item.turnId,
          kind: "file-change",
          changes: item.changes,
          output: item.output,
          fileChangeStatus: item.fileChangeStatus,
          status: item.status,
        } satisfies ChatFileChangeEntry,
      },
    ];
  }

  if (item.kind === "tool-call") {
    return [
      {
        kind: "standalone",
        entry: createGenericEntry({
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
      },
    ];
  }

  if (item.kind === "web-search") {
    return [
      {
        kind: "standalone",
        entry: createGenericEntry({
          id: item.id,
          turnId: item.turnId,
          itemType: "web-search",
          title: item.status === "streaming" ? "Searching the web" : "Searched the web",
          body: item.query,
          detailsJson: item.detailsJson,
          status: item.status,
        }),
      },
    ];
  }

  if (item.kind === "generic-item") {
    return [
      {
        kind: "standalone",
        entry: createGenericEntry({
          id: item.id,
          turnId: item.turnId,
          itemType: item.itemType,
          title: item.title,
          body: item.body,
          detailsJson: item.detailsJson,
          status: item.status,
        }),
      },
    ];
  }

  return [];
}

function projectItemsToEntries(input: {
  turnId: string;
  items: readonly NormalizedCodexThreadItem[];
}): readonly ChatEntry[] {
  return mapRenderedItemsToEntries(input);
}

function isTurnStartSteerEntry(steerEntry: ClientSteerEntry): steerEntry is TurnStartSteerEntry {
  return steerEntry.anchor.kind === "turn-start";
}

function isAfterItemSteerEntry(steerEntry: ClientSteerEntry): steerEntry is AfterItemSteerEntry {
  return steerEntry.anchor.kind === "after-item";
}

function isAfterAssistantTextSteerEntry(
  steerEntry: ClientSteerEntry,
): steerEntry is AfterAssistantTextSteerEntry {
  return steerEntry.anchor.kind === "after-assistant-text";
}

function appendProjectedItems(
  entries: ChatEntry[],
  input: {
    turnId: string;
    items: readonly NormalizedCodexThreadItem[];
  },
): void {
  entries.push(...projectItemsToEntries(input));
}

function appendAssistantItemEntries(input: {
  entries: ChatEntry[];
  turnId: string;
  assistantItem: Extract<NormalizedCodexThreadItem, { kind: "assistant-message" }>;
  siblingItems: readonly NormalizedCodexThreadItem[];
  steerEntriesAfterAssistantText: readonly AfterAssistantTextSteerEntry[];
  steerEntriesAfterWholeRawItem: readonly AfterItemSteerEntry[];
  steerOrderIndexByEntryId: ReadonlyMap<string, number>;
}): void {
  const {
    entries,
    turnId,
    assistantItem,
    siblingItems,
    steerEntriesAfterAssistantText,
    steerEntriesAfterWholeRawItem,
    steerOrderIndexByEntryId,
  } = input;
  let nextWholeRawItemSteerIndex = 0;

  function flushWholeRawItemSteersBefore(entryId: string): void {
    const entryOrderIndex = steerOrderIndexByEntryId.get(entryId);
    if (entryOrderIndex === undefined) {
      throw new Error(`Missing steer order index for entry '${entryId}'.`);
    }

    while (nextWholeRawItemSteerIndex < steerEntriesAfterWholeRawItem.length) {
      const wholeRawItemSteerEntry = steerEntriesAfterWholeRawItem[nextWholeRawItemSteerIndex];
      if (wholeRawItemSteerEntry === undefined) {
        break;
      }

      const wholeRawItemOrderIndex = steerOrderIndexByEntryId.get(wholeRawItemSteerEntry.entry.id);
      if (wholeRawItemOrderIndex === undefined) {
        throw new Error(
          `Missing steer order index for entry '${wholeRawItemSteerEntry.entry.id}'.`,
        );
      }

      if (wholeRawItemOrderIndex >= entryOrderIndex) {
        break;
      }

      entries.push(wholeRawItemSteerEntry.entry);
      nextWholeRawItemSteerIndex += 1;
    }
  }

  function flushRemainingWholeRawItemSteers(): void {
    while (nextWholeRawItemSteerIndex < steerEntriesAfterWholeRawItem.length) {
      const wholeRawItemSteerEntry = steerEntriesAfterWholeRawItem[nextWholeRawItemSteerIndex];
      if (wholeRawItemSteerEntry === undefined) {
        break;
      }

      entries.push(wholeRawItemSteerEntry.entry);
      nextWholeRawItemSteerIndex += 1;
    }
  }

  const canSplitAssistantItem = steerEntriesAfterAssistantText.every((steerEntry) =>
    assistantItem.text.startsWith(steerEntry.anchor.text),
  );

  if (!canSplitAssistantItem) {
    appendProjectedItems(entries, {
      turnId,
      items: [assistantItem],
    });
    appendProjectedItems(entries, {
      turnId,
      items: siblingItems,
    });

    for (const steerEntry of steerEntriesAfterAssistantText) {
      flushWholeRawItemSteersBefore(steerEntry.entry.id);
      entries.push(steerEntry.entry);
    }
    flushRemainingWholeRawItemSteers();
    return;
  }

  let consumedTextLength = 0;
  for (const steerEntry of steerEntriesAfterAssistantText) {
    const anchoredText = steerEntry.anchor.text;
    const nextSegmentText = anchoredText.slice(consumedTextLength);
    if (nextSegmentText.length > 0) {
      appendProjectedItems(entries, {
        turnId,
        items: [
          buildRenderedAssistantItemSegment({
            item: assistantItem,
            startOffset: consumedTextLength,
            text: nextSegmentText,
          }),
        ],
      });
    }

    flushWholeRawItemSteersBefore(steerEntry.entry.id);
    entries.push(steerEntry.entry);
    consumedTextLength = anchoredText.length;
  }

  const trailingAssistantText = assistantItem.text.slice(consumedTextLength);
  if (trailingAssistantText.length > 0) {
    appendProjectedItems(entries, {
      turnId,
      items: [
        buildRenderedAssistantItemSegment({
          item: assistantItem,
          startOffset: consumedTextLength,
          text: trailingAssistantText,
        }),
      ],
    });
  }

  appendProjectedItems(entries, {
    turnId,
    items: siblingItems,
  });
  flushRemainingWholeRawItemSteers();
}

function buildTurnEntries(turn: CodexRawTurnState): readonly ChatEntry[] {
  const entries: ChatEntry[] = [];
  const steerOrderIndexByEntryId = new Map(
    turn.clientSteerEntries.map((steerEntry, index) => [steerEntry.entry.id, index]),
  );
  const steerEntriesAtTurnStart: TurnStartSteerEntry[] = [];
  const steerEntriesAfterRawItemId = new Map<string, AfterItemSteerEntry[]>();
  const steerEntriesAfterAssistantText = new Map<string, AfterAssistantTextSteerEntry[]>();

  for (const steerEntry of turn.clientSteerEntries) {
    if (isTurnStartSteerEntry(steerEntry)) {
      steerEntriesAtTurnStart.push(steerEntry);
      continue;
    }

    if (isAfterItemSteerEntry(steerEntry)) {
      const anchoredEntries = steerEntriesAfterRawItemId.get(steerEntry.anchor.itemId) ?? [];
      anchoredEntries.push(steerEntry);
      steerEntriesAfterRawItemId.set(steerEntry.anchor.itemId, anchoredEntries);
      continue;
    }

    if (isAfterAssistantTextSteerEntry(steerEntry)) {
      const anchoredEntries = steerEntriesAfterAssistantText.get(steerEntry.anchor.itemId) ?? [];
      anchoredEntries.push(steerEntry);
      steerEntriesAfterAssistantText.set(steerEntry.anchor.itemId, anchoredEntries);
    }
  }

  if (turn.userEntry !== null) {
    entries.push(turn.userEntry);
  }

  entries.push(...steerEntriesAtTurnStart.map((steerEntry) => steerEntry.entry));

  let bufferedItems: NormalizedCodexThreadItem[] = [];

  function flushBufferedItems(): void {
    if (bufferedItems.length === 0) {
      return;
    }

    appendProjectedItems(entries, {
      turnId: turn.id,
      items: bufferedItems,
    });
    bufferedItems = [];
  }

  for (const rawItemId of turn.itemOrder) {
    const normalizedItemsForRawItem = buildNormalizedItemsForRawItem(turn, rawItemId);
    const assistantItem = normalizedItemsForRawItem.find(
      (item): item is Extract<NormalizedCodexThreadItem, { kind: "assistant-message" }> =>
        item.kind === "assistant-message",
    );
    const steerEntriesAfterAssistantSegments =
      assistantItem === undefined ? [] : (steerEntriesAfterAssistantText.get(rawItemId) ?? []);
    const steerEntriesAfterWholeRawItem = steerEntriesAfterRawItemId.get(rawItemId) ?? [];

    if (assistantItem !== undefined && steerEntriesAfterAssistantSegments.length > 0) {
      flushBufferedItems();
      const siblingItems = normalizedItemsForRawItem.filter(
        (item) => item.id !== assistantItem.id && item.kind !== "assistant-message",
      );
      appendAssistantItemEntries({
        entries,
        turnId: turn.id,
        assistantItem,
        siblingItems,
        steerEntriesAfterAssistantText: steerEntriesAfterAssistantSegments,
        steerEntriesAfterWholeRawItem,
        steerOrderIndexByEntryId,
      });
      continue;
    }

    bufferedItems.push(...normalizedItemsForRawItem);
    if (steerEntriesAfterWholeRawItem.length > 0) {
      flushBufferedItems();
      entries.push(...steerEntriesAfterWholeRawItem.map((steerEntry) => steerEntry.entry));
    }
  }

  flushBufferedItems();

  for (const steerEntry of turn.clientSteerEntries) {
    if (isTurnStartSteerEntry(steerEntry)) {
      continue;
    }

    if (isAfterItemSteerEntry(steerEntry)) {
      if (turn.rawItemsById[steerEntry.anchor.itemId] !== undefined) {
        continue;
      }

      throw new Error(
        `Missing steer anchor item '${steerEntry.anchor.itemId}' in turn '${turn.id}'.`,
      );
    }

    if (!isAfterAssistantTextSteerEntry(steerEntry)) {
      throw new Error(`Unsupported steer anchor kind in turn '${turn.id}'.`);
    }

    if (turn.rawItemsById[steerEntry.anchor.itemId] !== undefined) {
      continue;
    }

    throw new Error(
      `Missing assistant steer anchor item '${steerEntry.anchor.itemId}' in turn '${turn.id}'.`,
    );
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

  return entries;
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

    entries.push(...buildTurnEntries(turn));
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
  options?: Pick<ChatUserEntry, "label" | "labelAction">,
): ChatUserEntry {
  return {
    id: id ?? `user:${turnId}`,
    turnId,
    kind: "user-message",
    text,
    ...(options?.label === undefined ? {} : { label: options.label }),
    ...(options?.labelAction === undefined ? {} : { labelAction: options.labelAction }),
    ...(attachments.length === 0 ? {} : { attachments }),
    status: "completed",
  };
}

function clearEntrySteerPresentation(entry: ChatUserEntry): ChatUserEntry {
  const { label: _label, labelAction: _labelAction, ...nextEntry } = entry;
  return nextEntry;
}

function clearEntryAction(entry: ChatUserEntry): ChatUserEntry {
  const { labelAction: _labelAction, ...nextEntry } = entry;
  return nextEntry;
}

function getCurrentTurnSteerAnchor(turn: CodexRawTurnState): ClientSteerAnchor {
  const lastRawItemId = turn.itemOrder.at(-1);
  if (lastRawItemId === undefined) {
    return {
      kind: "turn-start",
    };
  }

  const normalizedItemsForLastRawItem = buildNormalizedItemsForRawItem(turn, lastRawItemId);
  const assistantItem = normalizedItemsForLastRawItem.find(
    (item): item is Extract<NormalizedCodexThreadItem, { kind: "assistant-message" }> =>
      item.kind === "assistant-message",
  );

  if (assistantItem !== undefined && assistantItem.text.length > 0) {
    return {
      kind: "after-assistant-text",
      itemId: lastRawItemId,
      text: assistantItem.text,
    };
  }

  return {
    kind: "after-item",
    itemId: lastRawItemId,
  };
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
  const existingFieldValue = isRecord(existingRawItem) ? existingRawItem[input.field] : undefined;
  const nextRawItem = isRecord(existingRawItem)
    ? {
        ...existingRawItem,
        type: input.itemType,
        id: input.itemId,
        status:
          typeof existingRawItem["status"] === "string" ? existingRawItem["status"] : "inProgress",
        [input.field]:
          typeof existingFieldValue === "string" ? existingFieldValue + input.delta : input.delta,
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

function reconcileHydratedTurns(
  state: CodexChatState,
  turns: readonly CodexThreadReadTurn[],
): CodexChatState {
  const nextTurnsById: Record<string, CodexRawTurnState> = {};
  const nextTurnOrder: string[] = [];
  const serverTurnIds = new Set<string>();

  for (const turn of turns) {
    serverTurnIds.add(turn.id);
    nextTurnOrder.push(turn.id);

    const existingTurn = state.turnsById[turn.id] ?? null;
    let serverUserEntry: ChatUserEntry | null = null;
    const serverItemOrder: string[] = [];
    const serverRawItemsById: Record<string, unknown> = {};

    for (const item of turn.items) {
      const parsedUserMessage = ThreadReadUserMessageItemSchema.safeParse(item);
      if (parsedUserMessage.success) {
        serverUserEntry = buildUserEntry(
          turn.id,
          parsedUserMessage.data.content.map((contentItem) => contentItem.text ?? "").join(""),
          parsedUserMessage.data.content.flatMap((contentItem) => {
            // Hydration only reconstructs attachments from structured localImage
            // items. Plain text remains plain text, even if it mentions paths.
            if (contentItem.type !== "localImage" || contentItem.path === undefined) {
              return [];
            }

            return [normalizeCodexLocalImageAttachment({ path: contentItem.path })];
          }),
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

      serverItemOrder.push(itemId);
      serverRawItemsById[itemId] = item;
    }

    const existingItemOrder = existingTurn?.itemOrder ?? [];
    const localOnlyItemOrder = existingItemOrder.filter(
      (itemId) => serverRawItemsById[itemId] === undefined,
    );
    const nextItemOrder = [...serverItemOrder, ...localOnlyItemOrder];
    const nextRawItemsById: Record<string, unknown> = {};

    for (const itemId of localOnlyItemOrder) {
      const existingRawItem = existingTurn?.rawItemsById[itemId];
      if (existingRawItem !== undefined) {
        nextRawItemsById[itemId] = existingRawItem;
      }
    }

    for (const itemId of serverItemOrder) {
      nextRawItemsById[itemId] = serverRawItemsById[itemId];
    }

    nextTurnsById[turn.id] = {
      id: turn.id,
      status: turn.status,
      completedStatus: isTerminalTurnStatus(turn.status) ? turn.status : null,
      completedErrorMessage: existingTurn?.completedErrorMessage ?? null,
      planSnapshot: existingTurn?.planSnapshot ?? null,
      userEntry: serverUserEntry ?? existingTurn?.userEntry ?? null,
      clientSteerEntries: existingTurn?.clientSteerEntries ?? [],
      itemOrder: nextItemOrder,
      rawItemsById: nextRawItemsById,
    };
  }

  for (const turnId of state.turnOrder) {
    if (serverTurnIds.has(turnId)) {
      continue;
    }

    const existingTurn = state.turnsById[turnId];
    if (existingTurn === undefined) {
      continue;
    }

    nextTurnOrder.push(turnId);
    nextTurnsById[turnId] = existingTurn;
  }

  return buildState({
    pendingTurnId: state.pendingTurnId,
    turnOrder: nextTurnOrder,
    turnsById: nextTurnsById,
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

  if (action.type === "turn_started") {
    const existingTurn = state.turnsById[action.turnId] ?? createTurnState(action.turnId);
    const nextTurnsById: Record<string, CodexRawTurnState> = {};
    for (const [turnId, turn] of Object.entries(state.turnsById)) {
      if (turnId !== action.turnId) {
        nextTurnsById[turnId] = turn;
      }
    }

    nextTurnsById[action.turnId] = {
      ...existingTurn,
      id: action.turnId,
      status: action.status,
      completedStatus: null,
      completedErrorMessage: null,
      planSnapshot: existingTurn.planSnapshot,
      userEntry: buildUserEntry(action.turnId, action.prompt, action.attachments ?? []),
      clientSteerEntries: existingTurn.clientSteerEntries,
      itemOrder: existingTurn.itemOrder,
      rawItemsById: existingTurn.rawItemsById,
    };

    return buildState({
      pendingTurnId: null,
      turnOrder: [...state.turnOrder, action.turnId].filter(
        (turnId, index, turnOrder) => turnOrder.indexOf(turnId) === index,
      ),
      turnsById: nextTurnsById,
    });
  }

  if (action.type === "hydrate_from_thread_read") {
    return reconcileHydratedTurns(state, action.turns);
  }

  if (action.type === "steer_turn_requested") {
    const ensured = ensureTurn(state.turnsById, state.turnOrder, action.turnId);
    const turn = ensured.turnsById[action.turnId] ?? createTurnState(action.turnId);

    return buildState({
      pendingTurnId: state.pendingTurnId,
      turnOrder: ensured.turnOrder,
      turnsById: {
        ...ensured.turnsById,
        [action.turnId]: {
          ...turn,
          clientSteerEntries: [
            ...turn.clientSteerEntries,
            {
              entry: buildUserEntry(
                action.turnId,
                action.prompt,
                action.attachments ?? [],
                action.entryId,
                {
                  label: "Steer",
                  labelAction: {
                    ariaLabel: "Remove steer message",
                    actionId: action.entryId,
                  },
                },
              ),
              requestState: "queued",
              anchor: getCurrentTurnSteerAnchor(turn),
            },
          ],
        },
      },
    });
  }

  if (action.type === "steer_turn_sending") {
    const turn = state.turnsById[action.turnId];
    if (turn === undefined) {
      return state;
    }

    return buildState({
      pendingTurnId: state.pendingTurnId,
      turnOrder: state.turnOrder,
      turnsById: {
        ...state.turnsById,
        [action.turnId]: {
          ...turn,
          clientSteerEntries: turn.clientSteerEntries.map((steerEntry) =>
            steerEntry.entry.id !== action.entryId
              ? steerEntry
              : {
                  ...steerEntry,
                  entry: clearEntryAction(steerEntry.entry),
                  requestState: "sending",
                },
          ),
        },
      },
    });
  }

  if (action.type === "steer_turn_processed") {
    const turn = state.turnsById[action.turnId];
    if (turn === undefined) {
      return state;
    }

    return buildState({
      pendingTurnId: state.pendingTurnId,
      turnOrder: state.turnOrder,
      turnsById: {
        ...state.turnsById,
        [action.turnId]: {
          ...turn,
          clientSteerEntries: turn.clientSteerEntries.map((steerEntry) =>
            steerEntry.entry.id !== action.entryId
              ? steerEntry
              : {
                  ...steerEntry,
                  entry: clearEntrySteerPresentation(steerEntry.entry),
                  requestState: "accepted",
                },
          ),
        },
      },
    });
  }

  if (action.type === "steer_turn_failed" || action.type === "dismiss_client_user_entry") {
    const turn = state.turnsById[action.turnId];
    if (turn === undefined) {
      return state;
    }

    return buildState({
      pendingTurnId: state.pendingTurnId,
      turnOrder: state.turnOrder,
      turnsById: {
        ...state.turnsById,
        [action.turnId]: {
          ...turn,
          clientSteerEntries: turn.clientSteerEntries.filter(
            (steerEntry) => steerEntry.entry.id !== action.entryId,
          ),
        },
      },
    });
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

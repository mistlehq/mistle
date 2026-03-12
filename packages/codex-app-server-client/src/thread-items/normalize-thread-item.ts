import { isRecord } from "../shared/is-record.js";
import type {
  NormalizedCodexThreadItem,
  NormalizedCommandAction,
  NormalizedFileChange,
} from "./types.js";

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

  return ["content", "parts", "summary", "summaryParts", "value"].flatMap((key) =>
    collectTextFragments(value[key], depth + 1),
  );
}

function collectText(value: unknown): string {
  return collectTextFragments(value, 0).join("");
}

function normalizeReasoningText(value: unknown): string {
  const text = collectText(value);
  if (text.length > 0) {
    return text;
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").join("\n");
  }

  return "";
}

function parseFileChanges(value: unknown): readonly NormalizedFileChange[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const changes: NormalizedFileChange[] = [];
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

function normalizeCommandActions(value: unknown): readonly NormalizedCommandAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const actions: NormalizedCommandAction[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const type = readOptionalString(entry, "type");
    const command = readOptionalString(entry, "command") ?? "";
    if (type === "read") {
      actions.push({
        type: "read",
        command,
        name: readOptionalString(entry, "name") ?? command,
        path: readOptionalString(entry, "path"),
      });
      continue;
    }

    if (type === "listFiles") {
      actions.push({
        type: "list-files",
        command,
        path: readOptionalString(entry, "path"),
      });
      continue;
    }

    if (type === "search") {
      actions.push({
        type: "search",
        command,
        query: readOptionalString(entry, "query"),
        path: readOptionalString(entry, "path"),
      });
      continue;
    }

    if (type === "unknown") {
      actions.push({
        type: "unknown",
        command,
      });
      continue;
    }
  }

  return actions;
}

function mapTransportStatus(value: string): "streaming" | "completed" {
  switch (value) {
    case "inProgress":
      return "streaming";
    case "completed":
    case "failed":
    case "declined":
      return "completed";
    default:
      throw new Error(`Unsupported transport status '${value}'.`);
  }
}

function normalizeToolCall(input: {
  item: Record<string, unknown>;
  turnId: string;
  toolType: "dynamic" | "mcp" | "collab";
  title: string | null;
  body: string | null;
  status: string | null;
}): readonly NormalizedCodexThreadItem[] {
  if (input.status === null) {
    throw new Error(`Missing tool-call status for '${input.toolType}'.`);
  }

  return [
    {
      kind: "tool-call",
      id: readRequiredId(input.item),
      turnId: input.turnId,
      toolType: input.toolType,
      title: input.title ?? input.toolType,
      body: input.body,
      detailsJson: serializeUnknown(input.item),
      status: mapTransportStatus(input.status),
    },
  ];
}

function readRequiredId(item: Record<string, unknown>): string {
  const id = readOptionalString(item, "id");
  if (id === null || id.length === 0) {
    throw new Error(`Thread item is missing a valid id. Payload: ${JSON.stringify(item)}`);
  }

  return id;
}

function readRequiredType(item: Record<string, unknown>): string {
  const type = readOptionalString(item, "type");
  if (type === null || type.length === 0) {
    throw new Error(`Thread item is missing a valid type. Payload: ${JSON.stringify(item)}`);
  }

  return type;
}

export function normalizeCodexThreadItem(input: {
  turnId: string;
  item: unknown;
}): readonly NormalizedCodexThreadItem[] {
  if (!isRecord(input.item)) {
    throw new Error(`Thread item must be an object. Payload: ${JSON.stringify(input.item)}`);
  }

  const item = input.item;
  const itemId = readRequiredId(item);
  const itemType = readRequiredType(item);

  if (itemType === "userMessage") {
    return [
      {
        kind: "user-message",
        id: itemId,
        turnId: input.turnId,
        text: collectText(item["content"]),
      },
    ];
  }

  if (itemType === "agentMessage") {
    return [
      {
        kind: "assistant-message",
        id: itemId,
        turnId: input.turnId,
        text: readOptionalString(item, "text") ?? collectText(item["content"]),
        phase: readOptionalString(item, "phase"),
        status: readOptionalString(item, "status") === "inProgress" ? "streaming" : "completed",
      },
    ];
  }

  if (itemType === "plan") {
    return [
      {
        kind: "plan",
        id: itemId,
        turnId: input.turnId,
        text: readOptionalString(item, "text") ?? collectText(item["content"]),
        status: readOptionalString(item, "status") === "inProgress" ? "streaming" : "completed",
      },
    ];
  }

  if (itemType === "reasoning") {
    const normalizedItems: NormalizedCodexThreadItem[] = [];
    const summaryText = normalizeReasoningText(item["summary"]);
    if (summaryText.length > 0) {
      normalizedItems.push({
        kind: "reasoning",
        id: itemId,
        turnId: input.turnId,
        source: "summary",
        text: summaryText,
        status: readOptionalString(item, "status") === "inProgress" ? "streaming" : "completed",
      });
    }

    const contentText = normalizeReasoningText(item["content"]);
    if (contentText.length > 0) {
      normalizedItems.push({
        kind: "reasoning",
        id: `${itemId}:content`,
        turnId: input.turnId,
        source: "content",
        text: contentText,
        status: readOptionalString(item, "status") === "inProgress" ? "streaming" : "completed",
      });
    }

    return normalizedItems;
  }

  if (itemType === "commandExecution") {
    const status = readOptionalString(item, "status");
    if (status === null) {
      throw new Error(`Missing commandExecution status. Payload: ${JSON.stringify(item)}`);
    }

    return [
      {
        kind: "command-execution",
        id: itemId,
        turnId: input.turnId,
        command: readOptionalString(item, "command"),
        cwd: readOptionalString(item, "cwd"),
        commandStatus: status,
        exitCode: readOptionalNumber(item, "exitCode"),
        output: readOptionalString(item, "aggregatedOutput") ?? readOptionalString(item, "output"),
        durationMs: readOptionalNumber(item, "durationMs"),
        commandActions: normalizeCommandActions(item["commandActions"]),
        reason: readOptionalString(item, "reason"),
        status: mapTransportStatus(status),
      },
    ];
  }

  if (itemType === "fileChange") {
    const status = readOptionalString(item, "status");
    if (status === null) {
      throw new Error(`Missing fileChange status. Payload: ${JSON.stringify(item)}`);
    }

    return [
      {
        kind: "file-change",
        id: itemId,
        turnId: input.turnId,
        fileChangeStatus: status,
        changes: parseFileChanges(item["changes"]),
        output: readOptionalString(item, "aggregatedOutput") ?? readOptionalString(item, "output"),
        status: mapTransportStatus(status),
      },
    ];
  }

  if (itemType === "mcpToolCall") {
    return normalizeToolCall({
      item,
      turnId: input.turnId,
      toolType: "mcp",
      title: readOptionalString(item, "tool"),
      body: null,
      status: readOptionalString(item, "status"),
    });
  }

  if (itemType === "dynamicToolCall") {
    return normalizeToolCall({
      item,
      turnId: input.turnId,
      toolType: "dynamic",
      title: readOptionalString(item, "tool"),
      body: null,
      status: readOptionalString(item, "status"),
    });
  }

  if (itemType === "collabAgentToolCall") {
    return normalizeToolCall({
      item,
      turnId: input.turnId,
      toolType: "collab",
      title: readOptionalString(item, "tool"),
      body: readOptionalString(item, "prompt"),
      status: readOptionalString(item, "status"),
    });
  }

  if (itemType === "webSearch") {
    const action = item["action"];
    return [
      {
        kind: "web-search",
        id: itemId,
        turnId: input.turnId,
        query: readOptionalString(item, "query"),
        detailsJson: action === null ? null : serializeUnknown(action),
        status: action === null ? "streaming" : "completed",
      },
    ];
  }

  return [
    {
      kind: "generic-item",
      id: itemId,
      turnId: input.turnId,
      itemType,
      title: itemType,
      body:
        readOptionalString(item, "title") ??
        readOptionalString(item, "text") ??
        readOptionalString(item, "name") ??
        readOptionalString(item, "query"),
      detailsJson: serializeUnknown(item),
      status: (() => {
        const status = readOptionalString(item, "status");
        if (status === null) {
          return "completed";
        }
        if (status === "inProgress") {
          return "streaming";
        }
        return "completed";
      })(),
    },
  ];
}

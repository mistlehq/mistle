import type { ClassifiedCodexThreadItem, NormalizedCodexThreadItem } from "./types.js";

function classifyCommandExecution(
  item: Extract<NormalizedCodexThreadItem, { kind: "command-execution" }>,
): ClassifiedCodexThreadItem {
  const counts = {
    reads: item.commandActions.filter((action) => action.type === "read").length,
    searches: item.commandActions.filter((action) => action.type === "search").length,
    lists: item.commandActions.filter((action) => action.type === "list-files").length,
  };
  const isExploring =
    item.commandActions.length > 0 &&
    item.commandActions.every(
      (action) =>
        action.type === "read" || action.type === "list-files" || action.type === "search",
    );

  if (isExploring) {
    return {
      item,
      semanticKind: "exploring",
      displayKeys: {
        active: "exploring.active",
        completed: "exploring.done",
      },
      status: item.status,
      summaryCounts: counts,
    };
  }

  return {
    item,
    semanticKind: "running-commands",
    displayKeys: {
      active: "running-commands.active",
      completed: null,
    },
    status: item.status,
    summaryCounts: null,
  };
}

export function classifyCodexThreadItemSemantics(
  item: NormalizedCodexThreadItem,
): ClassifiedCodexThreadItem {
  if (item.kind === "command-execution") {
    return classifyCommandExecution(item);
  }

  if (item.kind === "file-change") {
    return {
      item,
      semanticKind: "making-edits",
      displayKeys: {
        active: "making-edits.active",
        completed: null,
      },
      status: item.status,
      summaryCounts: null,
    };
  }

  if (item.kind === "reasoning") {
    return {
      item,
      semanticKind: "thinking",
      displayKeys: {
        active: "thinking.active",
        completed: null,
      },
      status: item.status,
      summaryCounts: null,
    };
  }

  if (item.kind === "web-search") {
    return {
      item,
      semanticKind: "searching-web",
      displayKeys: {
        active: "searching-web.active",
        completed: "searching-web.done",
      },
      status: item.status,
      summaryCounts: null,
    };
  }

  if (item.kind === "tool-call") {
    return {
      item,
      semanticKind: "tool-call",
      displayKeys: {
        active: "tool-call.active",
        completed: null,
      },
      status: item.status,
      summaryCounts: null,
    };
  }

  return {
    item,
    semanticKind: "generic",
    displayKeys: {
      active: "generic.active",
      completed: null,
    },
    status: "status" in item ? item.status : "completed",
    summaryCounts: null,
  };
}

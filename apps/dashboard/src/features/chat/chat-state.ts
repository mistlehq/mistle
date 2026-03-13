import type {
  ChatAssistantEntry,
  ChatCommandEntry,
  ChatEntry,
  ChatFileChangeEntry,
  ChatGenericItemEntry,
  ChatPlanEntry,
  ChatReasoningEntry,
  ChatUserEntry,
} from "./chat-types.js";

export type ChatTurnState = {
  id: string;
  status: string | null;
  completedStatus: string | null;
  completedErrorMessage: string | null;
  entryIds: readonly string[];
};

export type ChatState = {
  activeTurnId: string | null;
  pendingTurnId: string | null;
  status: string | null;
  completedStatus: string | null;
  completedErrorMessage: string | null;
  turnOrder: readonly string[];
  turnsById: Readonly<Record<string, ChatTurnState>>;
  entriesById: Readonly<Record<string, ChatEntry>>;
  entries: readonly ChatEntry[];
};

type ChatCoreState = {
  pendingTurnId: string | null;
  turnOrder: readonly string[];
  turnsById: Readonly<Record<string, ChatTurnState>>;
  entriesById: Readonly<Record<string, ChatEntry>>;
};

export type ChatHydratedTurn = {
  id: string;
  status: string | null;
  completedStatus: string | null;
  completedErrorMessage: string | null;
  entries: readonly ChatEntry[];
};

export type ChatAction =
  | {
      type: "reset";
    }
  | {
      type: "start_turn_requested";
      clientTurnId: string;
      prompt: string;
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
      type: "turn_status_updated";
      turnId: string;
      status: string;
    }
  | {
      type: "assistant_message_delta";
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "assistant_message_completed";
      turnId: string;
      itemId: string;
      text: string;
      phase: string | null;
    }
  | {
      type: "plan_delta";
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "plan_completed";
      turnId: string;
      itemId: string;
      text: string;
    }
  | {
      type: "reasoning_delta";
      turnId: string;
      itemId: string;
      delta: string;
      source: "summary" | "content";
    }
  | {
      type: "reasoning_completed";
      turnId: string;
      itemId: string;
      text: string;
      source: "summary" | "content";
    }
  | {
      type: "reasoning_part_added";
      turnId: string;
      itemId: string;
    }
  | {
      type: "command_completed";
      turnId: string;
      itemId: string;
      command: string | null;
      output: string | null;
      cwd: string | null;
      exitCode: number | null;
      commandStatus: string | null;
      reason: string | null;
    }
  | {
      type: "command_started";
      turnId: string;
      itemId: string;
      command: string | null;
      cwd: string | null;
      reason: string | null;
    }
  | {
      type: "command_output_delta";
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "file_change_started";
      turnId: string;
      itemId: string;
      changes: readonly {
        path: string;
        kind: string | null;
        diff: string | null;
      }[];
    }
  | {
      type: "file_change_output_delta";
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "file_change_completed";
      turnId: string;
      itemId: string;
      changes: readonly {
        path: string;
        kind: string | null;
        diff: string | null;
      }[];
      output: string | null;
      fileChangeStatus: string | null;
    }
  | {
      type: "generic_item_upserted";
      entry: ChatGenericItemEntry;
    }
  | {
      type: "turn_completed";
      turnId: string;
      status: string;
      errorMessage: string | null;
    }
  | {
      type: "hydrate_turns";
      turns: readonly ChatHydratedTurn[];
    };

function isTerminalTurnStatus(status: string | null): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

function createTurnState(turnId: string): ChatTurnState {
  return {
    id: turnId,
    status: null,
    completedStatus: null,
    completedErrorMessage: null,
    entryIds: [],
  };
}

function buildChatEntries(input: {
  turnOrder: readonly string[];
  turnsById: Readonly<Record<string, ChatTurnState>>;
  entriesById: Readonly<Record<string, ChatEntry>>;
}): readonly ChatEntry[] {
  const entries: ChatEntry[] = [];

  for (const turnId of input.turnOrder) {
    const turn = input.turnsById[turnId];
    if (turn === undefined) {
      continue;
    }

    for (const entryId of turn.entryIds) {
      const entry = input.entriesById[entryId];
      if (entry !== undefined) {
        entries.push(entry);
      }
    }
  }

  return entries;
}

function buildState(core: ChatCoreState): ChatState {
  const activeTurnId = core.turnOrder.at(-1) ?? null;
  const activeTurn = activeTurnId === null ? null : (core.turnsById[activeTurnId] ?? null);

  return {
    activeTurnId,
    pendingTurnId: core.pendingTurnId,
    status: activeTurn?.status ?? null,
    completedStatus:
      activeTurn === null
        ? null
        : (activeTurn.completedStatus ??
          (isTerminalTurnStatus(activeTurn.status) ? activeTurn.status : null)),
    completedErrorMessage: activeTurn?.completedErrorMessage ?? null,
    turnOrder: core.turnOrder,
    turnsById: core.turnsById,
    entriesById: core.entriesById,
    entries: buildChatEntries(core),
  };
}

function ensureTurn(core: ChatCoreState, turnId: string): ChatCoreState {
  if (core.turnsById[turnId] !== undefined) {
    return core;
  }

  return {
    ...core,
    turnOrder: [...core.turnOrder, turnId],
    turnsById: {
      ...core.turnsById,
      [turnId]: createTurnState(turnId),
    },
  };
}

function updateTurn(
  core: ChatCoreState,
  turnId: string,
  updater: (turn: ChatTurnState) => ChatTurnState,
): ChatCoreState {
  const ensuredCore = ensureTurn(core, turnId);
  const turn = ensuredCore.turnsById[turnId];

  if (turn === undefined) {
    throw new Error(`Missing chat turn '${turnId}'.`);
  }

  return {
    ...ensuredCore,
    turnsById: {
      ...ensuredCore.turnsById,
      [turnId]: updater(turn),
    },
  };
}

function upsertTurnEntry(core: ChatCoreState, turnId: string, entry: ChatEntry): ChatCoreState {
  const ensuredCore = ensureTurn(core, turnId);
  const turn = ensuredCore.turnsById[turnId];

  if (turn === undefined) {
    throw new Error(`Missing chat turn '${turnId}'.`);
  }

  const hasEntryId = turn.entryIds.includes(entry.id);

  return {
    ...ensuredCore,
    entriesById: {
      ...ensuredCore.entriesById,
      [entry.id]: entry,
    },
    turnsById: {
      ...ensuredCore.turnsById,
      [turnId]: {
        ...turn,
        entryIds: hasEntryId ? turn.entryIds : [...turn.entryIds, entry.id],
      },
    },
  };
}

function removeTurn(core: ChatCoreState, turnId: string): ChatCoreState {
  const turn = core.turnsById[turnId];
  if (turn === undefined) {
    return core;
  }

  const nextEntriesById: Record<string, ChatEntry> = {};
  for (const [entryId, entry] of Object.entries(core.entriesById)) {
    if (!turn.entryIds.includes(entryId)) {
      nextEntriesById[entryId] = entry;
    }
  }

  const nextTurnsById: Record<string, ChatTurnState> = {};
  for (const [key, value] of Object.entries(core.turnsById)) {
    if (key !== turnId) {
      nextTurnsById[key] = value;
    }
  }

  return {
    pendingTurnId: core.pendingTurnId === turnId ? null : core.pendingTurnId,
    turnOrder: core.turnOrder.filter((currentTurnId) => currentTurnId !== turnId),
    turnsById: nextTurnsById,
    entriesById: nextEntriesById,
  };
}

function rekeyTurn(
  core: ChatCoreState,
  input: {
    fromTurnId: string;
    toTurnId: string;
    status: string;
  },
): ChatCoreState {
  if (input.fromTurnId === input.toTurnId) {
    return updateTurn(core, input.toTurnId, (turn) => ({
      ...turn,
      id: input.toTurnId,
      status: input.status,
      completedStatus: null,
      completedErrorMessage: null,
    }));
  }

  const pendingTurn = core.turnsById[input.fromTurnId] ?? createTurnState(input.fromTurnId);
  const existingTurn = core.turnsById[input.toTurnId] ?? createTurnState(input.toTurnId);
  const pendingUserEntryId = `user:${input.fromTurnId}`;
  const existingUserEntryId = `user:${input.toTurnId}`;
  const pendingUserEntry = core.entriesById[pendingUserEntryId];

  const nextEntriesById: Record<string, ChatEntry> = {};
  for (const [entryId, entry] of Object.entries(core.entriesById)) {
    if (entryId === pendingUserEntryId && pendingUserEntry?.kind === "user-message") {
      nextEntriesById[existingUserEntryId] = {
        ...pendingUserEntry,
        id: existingUserEntryId,
        turnId: input.toTurnId,
      };
      continue;
    }

    if (entry.turnId === input.fromTurnId) {
      nextEntriesById[entryId] = {
        ...entry,
        turnId: input.toTurnId,
      };
      continue;
    }

    nextEntriesById[entryId] = entry;
  }

  if (
    pendingUserEntry?.kind === "user-message" &&
    nextEntriesById[existingUserEntryId] === undefined
  ) {
    nextEntriesById[existingUserEntryId] = {
      ...pendingUserEntry,
      id: existingUserEntryId,
      turnId: input.toTurnId,
    };
  }

  const mergedEntryIds = [
    ...pendingTurn.entryIds.map((entryId) =>
      entryId === pendingUserEntryId ? existingUserEntryId : entryId,
    ),
    ...existingTurn.entryIds.filter((entryId) => entryId !== existingUserEntryId),
  ].filter((entryId, index, array) => array.indexOf(entryId) === index);

  const nextTurnsById: Record<string, ChatTurnState> = {};
  for (const [turnId, turn] of Object.entries(core.turnsById)) {
    if (turnId !== input.fromTurnId && turnId !== input.toTurnId) {
      nextTurnsById[turnId] = turn;
    }
  }
  nextTurnsById[input.toTurnId] = {
    id: input.toTurnId,
    status: input.status,
    completedStatus: null,
    completedErrorMessage: null,
    entryIds: mergedEntryIds,
  };

  const nextTurnOrder = core.turnOrder
    .map((turnId) => (turnId === input.fromTurnId ? input.toTurnId : turnId))
    .filter((turnId, index, array) => array.indexOf(turnId) === index);

  if (!nextTurnOrder.includes(input.toTurnId)) {
    nextTurnOrder.push(input.toTurnId);
  }

  return {
    pendingTurnId: core.pendingTurnId === input.fromTurnId ? null : core.pendingTurnId,
    turnOrder: nextTurnOrder,
    turnsById: nextTurnsById,
    entriesById: nextEntriesById,
  };
}

function hydrateCoreState(turns: readonly ChatHydratedTurn[]): ChatCoreState {
  let core: ChatCoreState = {
    pendingTurnId: null,
    turnOrder: [],
    turnsById: {},
    entriesById: {},
  };

  for (const turn of turns) {
    core = updateTurn(core, turn.id, () => ({
      id: turn.id,
      status: turn.status,
      completedStatus:
        turn.completedStatus ?? (isTerminalTurnStatus(turn.status) ? turn.status : null),
      completedErrorMessage: turn.completedErrorMessage,
      entryIds: [],
    }));

    for (const entry of turn.entries) {
      core = upsertTurnEntry(core, turn.id, entry);
    }
  }

  return core;
}

export function createInitialChatState(): ChatState {
  return buildState({
    pendingTurnId: null,
    turnOrder: [],
    turnsById: {},
    entriesById: {},
  });
}

export function reduceChatState(state: ChatState, action: ChatAction): ChatState {
  if (action.type === "reset") {
    return createInitialChatState();
  }

  const core: ChatCoreState = {
    pendingTurnId: state.pendingTurnId,
    turnOrder: state.turnOrder,
    turnsById: state.turnsById,
    entriesById: state.entriesById,
  };

  if (action.type === "start_turn_requested") {
    return buildState(
      upsertTurnEntry(
        updateTurn(
          {
            ...core,
            pendingTurnId: action.clientTurnId,
          },
          action.clientTurnId,
          (turn) => ({
            ...turn,
            status: "starting",
            completedStatus: null,
            completedErrorMessage: null,
          }),
        ),
        action.clientTurnId,
        {
          id: `user:${action.clientTurnId}`,
          turnId: action.clientTurnId,
          kind: "user-message",
          text: action.prompt,
          status: "completed",
        } satisfies ChatUserEntry,
      ),
    );
  }

  if (action.type === "start_turn_failed") {
    return buildState(removeTurn(core, action.clientTurnId));
  }

  if (action.type === "turn_started_response") {
    return buildState(
      rekeyTurn(core, {
        fromTurnId: action.clientTurnId,
        toTurnId: action.turnId,
        status: action.status,
      }),
    );
  }

  if (action.type === "turn_status_updated") {
    return buildState(
      updateTurn(core, action.turnId, (turn) => ({
        ...turn,
        status: action.status,
      })),
    );
  }

  if (action.type === "assistant_message_delta") {
    const existingEntry = core.entriesById[action.itemId];
    const nextEntry: ChatAssistantEntry = {
      id: action.itemId,
      turnId: action.turnId,
      kind: "assistant-message",
      text:
        existingEntry?.kind === "assistant-message"
          ? `${existingEntry.text}${action.delta}`
          : action.delta,
      phase: existingEntry?.kind === "assistant-message" ? existingEntry.phase : null,
      status: "streaming",
    };

    return buildState(upsertTurnEntry(core, action.turnId, nextEntry));
  }

  if (action.type === "assistant_message_completed") {
    return buildState(
      upsertTurnEntry(core, action.turnId, {
        id: action.itemId,
        turnId: action.turnId,
        kind: "assistant-message",
        text: action.text,
        phase: action.phase,
        status: "completed",
      } satisfies ChatAssistantEntry),
    );
  }

  if (action.type === "plan_delta") {
    const existingEntry = core.entriesById[action.itemId];
    const nextEntry: ChatPlanEntry = {
      id: action.itemId,
      turnId: action.turnId,
      kind: "plan",
      text:
        existingEntry?.kind === "plan" && existingEntry.text !== null
          ? `${existingEntry.text}${action.delta}`
          : action.delta,
      explanation: null,
      steps: null,
      status: "streaming",
    };

    return buildState(upsertTurnEntry(core, action.turnId, nextEntry));
  }

  if (action.type === "plan_completed") {
    return buildState(
      upsertTurnEntry(core, action.turnId, {
        id: action.itemId,
        turnId: action.turnId,
        kind: "plan",
        text: action.text,
        explanation: null,
        steps: null,
        status: "completed",
      } satisfies ChatPlanEntry),
    );
  }

  if (action.type === "reasoning_delta") {
    const existingEntry = core.entriesById[action.itemId];
    const existingText =
      existingEntry?.kind === "reasoning" && existingEntry.source === action.source
        ? existingEntry.summary
        : "";
    const nextEntry: ChatReasoningEntry = {
      id: action.itemId,
      turnId: action.turnId,
      kind: "reasoning",
      summary: `${existingText}${action.delta}`,
      source: action.source,
      status: "streaming",
    };

    return buildState(upsertTurnEntry(core, action.turnId, nextEntry));
  }

  if (action.type === "reasoning_completed") {
    return buildState(
      upsertTurnEntry(core, action.turnId, {
        id: action.itemId,
        turnId: action.turnId,
        kind: "reasoning",
        summary: action.text,
        source: action.source,
        status: "completed",
      } satisfies ChatReasoningEntry),
    );
  }

  if (action.type === "reasoning_part_added") {
    const existingEntry = core.entriesById[action.itemId];
    if (existingEntry?.kind !== "reasoning") {
      return state;
    }

    return buildState(
      upsertTurnEntry(core, action.turnId, {
        ...existingEntry,
        summary:
          existingEntry.summary.length === 0
            ? existingEntry.summary
            : `${existingEntry.summary}\n\n`,
      }),
    );
  }

  if (action.type === "command_started") {
    return buildState(
      upsertTurnEntry(core, action.turnId, {
        id: action.itemId,
        turnId: action.turnId,
        kind: "command-execution",
        command: action.command,
        output: null,
        cwd: action.cwd,
        exitCode: null,
        commandStatus: "in_progress",
        reason: action.reason,
        status: "streaming",
      } satisfies ChatCommandEntry),
    );
  }

  if (action.type === "command_output_delta") {
    const existingEntry = core.entriesById[action.itemId];
    const nextEntry: ChatCommandEntry = {
      id: action.itemId,
      turnId: action.turnId,
      kind: "command-execution",
      command: existingEntry?.kind === "command-execution" ? existingEntry.command : null,
      output:
        existingEntry?.kind === "command-execution"
          ? `${existingEntry.output ?? ""}${action.delta}`
          : action.delta,
      cwd: existingEntry?.kind === "command-execution" ? existingEntry.cwd : null,
      exitCode: existingEntry?.kind === "command-execution" ? existingEntry.exitCode : null,
      commandStatus:
        existingEntry?.kind === "command-execution" ? existingEntry.commandStatus : "in_progress",
      reason: existingEntry?.kind === "command-execution" ? existingEntry.reason : null,
      status: "streaming",
    };

    return buildState(upsertTurnEntry(core, action.turnId, nextEntry));
  }

  if (action.type === "command_completed") {
    return buildState(
      upsertTurnEntry(core, action.turnId, {
        id: action.itemId,
        turnId: action.turnId,
        kind: "command-execution",
        command: action.command,
        output: action.output,
        cwd: action.cwd,
        exitCode: action.exitCode,
        commandStatus: action.commandStatus,
        reason: action.reason,
        status: "completed",
      } satisfies ChatCommandEntry),
    );
  }

  if (action.type === "file_change_started") {
    return buildState(
      upsertTurnEntry(core, action.turnId, {
        id: action.itemId,
        turnId: action.turnId,
        kind: "file-change",
        changes: action.changes,
        output: null,
        fileChangeStatus: "in_progress",
        status: "streaming",
      } satisfies ChatFileChangeEntry),
    );
  }

  if (action.type === "file_change_output_delta") {
    const existingEntry = core.entriesById[action.itemId];
    const nextEntry: ChatFileChangeEntry = {
      id: action.itemId,
      turnId: action.turnId,
      kind: "file-change",
      changes: existingEntry?.kind === "file-change" ? existingEntry.changes : [],
      output:
        existingEntry?.kind === "file-change"
          ? `${existingEntry.output ?? ""}${action.delta}`
          : action.delta,
      fileChangeStatus:
        existingEntry?.kind === "file-change" ? existingEntry.fileChangeStatus : "in_progress",
      status: "streaming",
    };

    return buildState(upsertTurnEntry(core, action.turnId, nextEntry));
  }

  if (action.type === "file_change_completed") {
    return buildState(
      upsertTurnEntry(core, action.turnId, {
        id: action.itemId,
        turnId: action.turnId,
        kind: "file-change",
        changes: action.changes,
        output: action.output,
        fileChangeStatus: action.fileChangeStatus,
        status: "completed",
      } satisfies ChatFileChangeEntry),
    );
  }

  if (action.type === "generic_item_upserted") {
    return buildState(upsertTurnEntry(core, action.entry.turnId, action.entry));
  }

  if (action.type === "turn_completed") {
    return buildState(
      updateTurn(core, action.turnId, (turn) => ({
        ...turn,
        status: action.status,
        completedStatus: action.status,
        completedErrorMessage: action.errorMessage,
      })),
    );
  }

  return buildState(hydrateCoreState(action.turns));
}

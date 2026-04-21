import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";

import type { ChatEntry } from "../chat/chat-types.js";
import { ChatUserMessage } from "../chat/components/chat-user-message.js";
import { CodexFixtureSessionModelOptions } from "../session-agents/codex/fixtures/session-fixtures.js";
import { SessionComposerFixtureProps } from "../session-agents/codex/fixtures/session-fixtures.js";
import {
  SessionConversationBottomPanel,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import {
  SessionConversationScrollBehaviorArgType,
  type SessionConversationScrollBehaviorStoryArg,
} from "./session-conversation-story-scroll-behavior.js";
import {
  SessionWorkbenchStoryChrome,
  StorySessionConversationPaneArgs,
} from "./session-story-support.js";
import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";

type SessionWorkbenchLiveSimulationStoryArgs = React.ComponentProps<
  typeof SessionWorkbenchPageView
> &
  SessionConversationScrollBehaviorStoryArg;

type QueuedPrompt = {
  id: string;
  text: string;
};

const LiveHarnessSeedEntries: readonly ChatEntry[] = [
  {
    id: "live-seed-user-1",
    turnId: "live-seed-turn-1",
    kind: "user-message",
    status: "completed",
    text: "Give me 2 eerie coastal fantasy blurbs.",
  },
  {
    id: "live-seed-assistant-1",
    turnId: "live-seed-turn-1",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: [
      "1. A ghost ship appears, disappears, and leaves Brinehollow unraveling: dead ovens, dry wells, and a dread no prayer can quiet. Cartographer Elin discovers a lost ledger proving her village once kept a pact with the sea, paid in fire and warning bells. As a new storm rises, she must restore the ritual before the ocean claims its due.",
      "",
      "2. In a coastal town built on superstition and salt, Elin maps what others dismiss: patterns in fear, weather, and wreckage. Her search leads to a submerged vault and a record of debts the sea never forgets. Atmospheric and urgent, this story follows one woman racing to reconnect a broken chain of harbors before history repeats in water and ruin.",
    ].join("\n\n"),
  },
];

const LiveHarnessStreamingChunkStarts = [
  "When a flagless wreck drifts into Brinehollow and vanishes by dawn, strange failures spread through the village and panic follows.",
  "Cartographer Elin traces the pattern to a forgotten fire, a missing keeper, and a copper-bound storm ledger that suggests the sea can be bargained with, but never ignored.",
  "To save her home, she must turn scattered memory into action before the next wave settles the balance.",
  "Each bell tower along the coast remembers the pact differently, and every retelling changes what Elin believes she owes the sea.",
  "What begins as salvage becomes witness work: tide charts, burial records, and half-burned harbor maps that refuse to line up cleanly.",
  "The closer she gets to the truth, the more Brinehollow starts behaving like a place waiting to be reclaimed rather than rescued.",
] as const;

const LiveHarnessStreamingChunkClosers = [
  "The village calls it bad luck; Elin recognizes a pattern that is trying to finish an older story.",
  "Every answer widens the debt ledger, and every witness seems to remember a different price being paid.",
  "What the town dismissed as folklore starts reading like operating instructions for surviving the next storm.",
  "The deeper she looks, the clearer it becomes that silence has been part of the ritual all along.",
  "By the time the harbor lights begin failing in sequence, delay is no longer neutral.",
  "What she uncovers would be easier to bury again, but the coastline has already started choosing for her.",
] as const;

function createStreamingChunk(chunkNumber: number): string {
  const start =
    LiveHarnessStreamingChunkStarts[(chunkNumber - 1) % LiveHarnessStreamingChunkStarts.length];
  const closer =
    LiveHarnessStreamingChunkClosers[(chunkNumber - 1) % LiveHarnessStreamingChunkClosers.length];
  return `${chunkNumber}. ${start} ${closer}`;
}

function createLargeAssistantBlock(startingChunkNumber: number, chunkCount: number): string {
  return Array.from({ length: chunkCount }, (_, index) =>
    createStreamingChunk(startingChunkNumber + index),
  ).join("\n\n");
}

function formatSteerMessage(text: string): string {
  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    return "";
  }

  return trimmedText;
}

function removeSteerEntryById(input: {
  entryId: string;
  setEntries: React.Dispatch<React.SetStateAction<readonly ChatEntry[]>>;
}): void {
  input.setEntries((currentEntries) =>
    currentEntries.filter((entry) => entry.id !== input.entryId),
  );
}

function acceptSteerEntryById(input: {
  entryId: string;
  setEntries: React.Dispatch<React.SetStateAction<readonly ChatEntry[]>>;
}): void {
  input.setEntries((currentEntries) =>
    currentEntries.map((entry) => {
      if (entry.kind !== "user-message" || entry.id !== input.entryId) {
        return entry;
      }

      const { label: _label, labelAction: _labelAction, ...acceptedEntry } = entry;
      return acceptedEntry;
    }),
  );
}

function createLiveHarnessStartedTurnEntries(input: {
  assistantText: string;
  turnId: string;
  userText: string;
}): readonly ChatEntry[] {
  return [
    {
      id: `${input.turnId}:user`,
      turnId: input.turnId,
      kind: "user-message",
      status: "completed",
      text: input.userText,
    },
    {
      id: `${input.turnId}:assistant`,
      turnId: input.turnId,
      kind: "assistant-message",
      phase: null,
      status: "streaming",
      text: input.assistantText,
    },
  ];
}

function replaceTurnIdInEntries(input: {
  entries: readonly ChatEntry[];
  nextTurnId: string;
  previousTurnId: string;
}): readonly ChatEntry[] {
  return input.entries.map((entry) => {
    if (entry.turnId !== input.previousTurnId) {
      return entry;
    }

    return {
      ...entry,
      id: entry.id.replace(input.previousTurnId, input.nextTurnId),
      turnId: input.nextTurnId,
    };
  });
}

function appendAssistantTextAfterLatestTurnEntry(input: {
  activeTurnId: string;
  addedText: string;
  currentEntries: readonly ChatEntry[];
}): readonly ChatEntry[] {
  let lastEntryIndex = -1;
  for (let index = input.currentEntries.length - 1; index >= 0; index -= 1) {
    const entry = input.currentEntries[index];
    if (entry?.turnId === input.activeTurnId) {
      lastEntryIndex = index;
      break;
    }
  }

  if (lastEntryIndex === -1) {
    return input.currentEntries;
  }

  const lastEntry = input.currentEntries[lastEntryIndex];
  if (lastEntry?.kind === "assistant-message") {
    return input.currentEntries.map((entry, index) => {
      if (index !== lastEntryIndex || entry.kind !== "assistant-message") {
        return entry;
      }

      return {
        ...entry,
        status: "streaming",
        text: `${entry.text}\n\n${input.addedText}`,
      };
    });
  }

  return [
    ...input.currentEntries,
    {
      id: `${input.activeTurnId}:assistant-followup:${crypto.randomUUID()}`,
      turnId: input.activeTurnId,
      kind: "assistant-message",
      phase: null,
      status: "streaming",
      text: input.addedText,
    },
  ];
}

function SessionConversationWorkbenchHarness(input: {
  scrollBehavior: SessionConversationScrollBehaviorStoryArg["scrollBehavior"];
}): React.JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingSteerAcceptanceFrameIdsRef = useRef<number[]>([]);
  const [entries, setEntries] = useState<readonly ChatEntry[]>(LiveHarnessSeedEntries);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("give me 2 more blurbs");
  const [nextTurnIndex, setNextTurnIndex] = useState(1);
  const [streamChunkIndex, setStreamChunkIndex] = useState(0);
  const [queuedPrompts, setQueuedPrompts] = useState<readonly QueuedPrompt[]>([]);
  const [autoStartingQueuedPromptId, setAutoStartingQueuedPromptId] = useState<string | null>(null);
  const hasRunningTurn = activeTurnId !== null && pendingTurnId === null;
  const canQueueCurrentDraft = hasRunningTurn && composerText.trim().length > 0;
  const submitMode =
    pendingTurnId !== null || autoStartingQueuedPromptId !== null
      ? "start"
      : activeTurnId === null
        ? "start"
        : composerText.trim().length === 0
          ? "interrupt"
          : "steer";
  const submitLabel = submitMode === "start" ? "Send" : submitMode === "steer" ? "Steer" : "Stop";
  const statusMessage = null;

  function launchTurn(submittedPrompt: string): void {
    if (submittedPrompt.length === 0) {
      return;
    }

    const pendingId = `pending-turn-${nextTurnIndex}`;
    const realId = `live-turn-${nextTurnIndex}`;
    setNextTurnIndex((current) => current + 1);
    setPendingTurnId(pendingId);
    setActiveTurnId(pendingId);
    setStreamChunkIndex(1);
    setComposerText("");
    setEntries((currentEntries) => [
      ...currentEntries,
      ...createLiveHarnessStartedTurnEntries({
        assistantText: createStreamingChunk(1),
        turnId: pendingId,
        userText: submittedPrompt,
      }),
    ]);

    requestAnimationFrame(() => {
      setEntries((currentEntries) =>
        replaceTurnIdInEntries({
          entries: currentEntries,
          nextTurnId: realId,
          previousTurnId: pendingId,
        }),
      );
      setPendingTurnId(null);
      setActiveTurnId(realId);
    });
  }

  function startNewTurn(): void {
    launchTurn(composerText.trim());
    setComposerText("");
  }

  function steerActiveTurn(): void {
    const steeringPrompt = composerText.trim();
    if (steeringPrompt.length === 0 || activeTurnId === null) {
      return;
    }

    const steerEntryId = `steer-user-${crypto.randomUUID()}`;

    setEntries((currentEntries) => [
      ...currentEntries,
      {
        id: steerEntryId,
        turnId: activeTurnId,
        kind: "user-message",
        label: "Steer",
        labelAction: {
          ariaLabel: "Remove steer message",
          actionId: steerEntryId,
        },
        status: "completed",
        text: formatSteerMessage(steeringPrompt),
      },
    ]);
    const outerFrameId = requestAnimationFrame(() => {
      const innerFrameId = requestAnimationFrame(() => {
        acceptSteerEntryById({
          entryId: steerEntryId,
          setEntries,
        });
        pendingSteerAcceptanceFrameIdsRef.current =
          pendingSteerAcceptanceFrameIdsRef.current.filter(
            (frameId) => frameId !== outerFrameId && frameId !== innerFrameId,
          );
      });
      pendingSteerAcceptanceFrameIdsRef.current.push(innerFrameId);
    });
    pendingSteerAcceptanceFrameIdsRef.current.push(outerFrameId);
    setComposerText("");
  }

  function queueCurrentDraft(): void {
    const queuedText = composerText.trim();
    if (queuedText.length === 0) {
      return;
    }

    setQueuedPrompts((currentQueuedPrompts) => [
      ...currentQueuedPrompts,
      {
        id: `queued-prompt-${crypto.randomUUID()}`,
        text: queuedText,
      },
    ]);
    setComposerText("");
  }

  function removeQueuedPrompt(queuedPromptId: string): void {
    setQueuedPrompts((currentQueuedPrompts) =>
      currentQueuedPrompts.filter((queuedPrompt) => queuedPrompt.id !== queuedPromptId),
    );
  }

  function completeActiveTurn(): void {
    if (activeTurnId === null) {
      return;
    }

    setEntries((currentEntries) =>
      currentEntries.map((entry) => {
        if (entry.kind !== "assistant-message" || entry.turnId !== activeTurnId) {
          return entry;
        }

        return {
          ...entry,
          status: "completed",
        };
      }),
    );
    setPendingTurnId(null);
    setActiveTurnId(null);
    setStreamChunkIndex(0);
  }

  useEffect(() => {
    if (
      activeTurnId !== null ||
      pendingTurnId !== null ||
      autoStartingQueuedPromptId !== null ||
      queuedPrompts.length === 0
    ) {
      return;
    }

    const [nextQueuedPrompt] = queuedPrompts;
    if (nextQueuedPrompt === undefined) {
      return;
    }

    setAutoStartingQueuedPromptId(nextQueuedPrompt.id);
    setQueuedPrompts((currentQueuedPrompts) => currentQueuedPrompts.slice(1));

    requestAnimationFrame(() => {
      launchTurn(nextQueuedPrompt.text);
      setAutoStartingQueuedPromptId(null);
    });
  }, [activeTurnId, autoStartingQueuedPromptId, pendingTurnId, queuedPrompts]);

  useEffect(() => {
    return () => {
      for (const frameId of pendingSteerAcceptanceFrameIdsRef.current) {
        cancelAnimationFrame(frameId);
      }
      pendingSteerAcceptanceFrameIdsRef.current = [];
    };
  }, []);

  function streamNextChunk(): void {
    if (activeTurnId === null || pendingTurnId !== null) {
      return;
    }

    const nextChunkIndex = streamChunkIndex + 1;

    setStreamChunkIndex(nextChunkIndex);
    setEntries((currentEntries) =>
      appendAssistantTextAfterLatestTurnEntry({
        activeTurnId,
        addedText: createStreamingChunk(nextChunkIndex),
        currentEntries,
      }),
    );
  }

  function showLargeBlock(): void {
    if (activeTurnId === null || pendingTurnId !== null) {
      return;
    }

    const chunkCount = 12;
    const startingChunkIndex = streamChunkIndex + 1;
    const nextChunkIndex = streamChunkIndex + chunkCount;

    setStreamChunkIndex(nextChunkIndex);
    setEntries((currentEntries) =>
      appendAssistantTextAfterLatestTurnEntry({
        activeTurnId,
        addedText: createLargeAssistantBlock(startingChunkIndex, chunkCount),
        currentEntries,
      }),
    );
  }

  function resetHarness(): void {
    for (const frameId of pendingSteerAcceptanceFrameIdsRef.current) {
      cancelAnimationFrame(frameId);
    }
    pendingSteerAcceptanceFrameIdsRef.current = [];
    setEntries(LiveHarnessSeedEntries);
    setActiveTurnId(null);
    setPendingTurnId(null);
    setComposerText("give me 2 more blurbs");
    setNextTurnIndex(1);
    setStreamChunkIndex(0);
    setQueuedPrompts([]);
    setAutoStartingQueuedPromptId(null);
    if (scrollContainerRef.current !== null) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }

  return (
    <SessionWorkbenchPageView
      alert={null}
      bottomPanel={<></>}
      isBottomPanelVisible={false}
      isSecondaryPanelVisible={true}
      mainContent={
        <SessionConversationMainContent
          activeTurnId={activeTurnId}
          chatEntries={entries}
          isRespondingToServerRequest={false}
          isTurnInProgress={activeTurnId !== null}
          onUserMessageAction={(actionId) => {
            removeSteerEntryById({
              entryId: actionId,
              setEntries,
            });
          }}
          onRespondToServerRequest={StorySessionConversationPaneArgs.onRespondToServerRequest}
          pendingTurnId={pendingTurnId}
          scrollContainerRef={scrollContainerRef}
          serverRequestPanelEntries={[]}
          {...(input.scrollBehavior === undefined
            ? {}
            : {
                scrollBehavior: input.scrollBehavior,
              })}
        />
      }
      mainContentScrollContainerRef={scrollContainerRef}
      primaryBottomPanel={
        <div className="space-y-3">
          {hasRunningTurn && queuedPrompts.length > 0 ? (
            <div className="max-h-40 space-y-2 overflow-y-auto px-1 pr-2">
              {queuedPrompts.map((queuedPrompt) => (
                <ChatUserMessage
                  key={queuedPrompt.id}
                  label="Queue"
                  labelAction={{
                    ariaLabel: "Remove queued message",
                    onClick: () => {
                      removeQueuedPrompt(queuedPrompt.id);
                    },
                  }}
                  text={queuedPrompt.text}
                />
              ))}
            </div>
          ) : null}

          <SessionConversationBottomPanel
            chatEntries={entries}
            composerViewModel={{
              ...SessionComposerFixtureProps,
              composerText,
              isSubmitPending: pendingTurnId !== null || autoStartingQueuedPromptId !== null,
              keyboardShortcuts:
                hasRunningTurn && composerText.trim().length > 0
                  ? [
                      { action: "Steer", shortcut: "enter" },
                      { action: "Queue", shortcut: "mod-enter" },
                    ]
                  : [],
              modelOptions: CodexFixtureSessionModelOptions,
              onComposerTextChange: setComposerText,
              onSubmit: () => {
                if (submitMode === "start") {
                  startNewTurn();
                  return;
                }

                if (submitMode === "steer") {
                  steerActiveTurn();
                  return;
                }

                completeActiveTurn();
              },
              onSecondarySubmit: queueCurrentDraft,
              secondarySubmitDisabled: !canQueueCurrentDraft,
              submitDisabled:
                pendingTurnId !== null ||
                autoStartingQueuedPromptId !== null ||
                (submitMode === "interrupt" ? false : composerText.trim().length === 0),
              submitLabel:
                pendingTurnId !== null || autoStartingQueuedPromptId !== null
                  ? "Sending..."
                  : submitLabel,
              submitMode,
            }}
            isRespondingToServerRequest={false}
            onRespondToServerRequest={StorySessionConversationPaneArgs.onRespondToServerRequest}
            serverRequestPanelEntries={[]}
            showWorkingIndicator={activeTurnId !== null && pendingTurnId === null}
            statusMessage={statusMessage}
          />
        </div>
      }
      sandboxInstanceId="sbi_storybook_scroll_sim"
      secondaryPanel={
        <div className="bg-background flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Live Session Simulation</p>
            <p className="text-muted-foreground text-sm leading-6">
              This harness models the real workbench surface, including pending turn ids, active
              turn ids, with queueing triggered from the composer shortcut instead of extra UI
              chrome.
            </p>
          </div>

          <div className="grid gap-2 text-sm">
            <div>
              <span className="font-medium">pendingTurnId:</span> {pendingTurnId ?? "none"}
            </div>
            <div>
              <span className="font-medium">activeTurnId:</span> {activeTurnId ?? "none"}
            </div>
            <div>
              <span className="font-medium">submitMode:</span> {submitMode}
            </div>
            <div>
              <span className="font-medium">streamChunkIndex:</span> {streamChunkIndex}
            </div>
            <div>
              <span className="font-medium">queuedPrompts:</span> {queuedPrompts.length}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={activeTurnId !== null} onClick={startNewTurn} variant="secondary">
              Start Next Turn
            </Button>
            <Button
              disabled={activeTurnId === null || pendingTurnId !== null}
              onClick={streamNextChunk}
              variant="secondary"
            >
              Stream Chunk
            </Button>
            <Button
              disabled={activeTurnId === null || pendingTurnId !== null}
              onClick={showLargeBlock}
              variant="secondary"
            >
              Show Large Block
            </Button>
            <Button
              disabled={activeTurnId === null}
              onClick={completeActiveTurn}
              variant="secondary"
            >
              Complete Turn
            </Button>
            <Button onClick={resetHarness} variant="ghost">
              Reset
            </Button>
          </div>

          {hasRunningTurn ? (
            <p className="text-muted-foreground text-sm leading-6">
              Type in the composer, then press <code>Enter</code> to steer or{" "}
              <code>Cmd/Ctrl+Enter</code> to queue the next prompt.
            </p>
          ) : null}

          {queuedPrompts.length === 0 ? null : (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Queued follow-ups
              </p>
              <div className="space-y-2">
                {queuedPrompts.map((queuedPrompt, index) => (
                  <div
                    className="bg-muted/40 flex items-center justify-between gap-3 rounded-md px-3 py-2"
                    key={queuedPrompt.id}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                        Next {String(index + 1)}
                      </p>
                      <p className="truncate text-sm">{queuedPrompt.text}</p>
                    </div>
                    <Button
                      onClick={() => {
                        removeQueuedPrompt(queuedPrompt.id);
                      }}
                      type="button"
                      variant="ghost"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      }
    />
  );
}

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/ConversationPane/LiveSimulation",
  component: SessionWorkbenchPageView,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    sandboxInstanceId: null,
    alert: null,
    bottomPanel: <></>,
    isBottomPanelVisible: true,
    isSecondaryPanelVisible: false,
    mainContent: <></>,
    scrollBehavior: "follow-streaming-at-bottom",
    primaryBottomPanel: <></>,
    secondaryPanel: <></>,
  },
  argTypes: {
    scrollBehavior: SessionConversationScrollBehaviorArgType,
  },
  decorators: [
    function StoryDecorator(Story): React.JSX.Element {
      return (
        <SessionWorkbenchStoryChrome>
          <Story />
        </SessionWorkbenchStoryChrome>
      );
    },
  ],
} satisfies Meta<SessionWorkbenchLiveSimulationStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="h-full min-h-0">
      <SessionConversationWorkbenchHarness scrollBehavior={args.scrollBehavior} />
    </div>
  ),
};

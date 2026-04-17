import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef, useState } from "react";

import type { ChatEntry } from "../chat/chat-types.js";
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

function SessionConversationWorkbenchHarness(input: {
  scrollBehavior: SessionConversationScrollBehaviorStoryArg["scrollBehavior"];
}): React.JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [entries, setEntries] = useState<readonly ChatEntry[]>(LiveHarnessSeedEntries);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("give me 2 more blurbs");
  const [nextTurnIndex, setNextTurnIndex] = useState(1);
  const [streamChunkIndex, setStreamChunkIndex] = useState(0);
  const submitMode =
    pendingTurnId !== null
      ? "start"
      : activeTurnId === null
        ? "start"
        : composerText.trim().length === 0
          ? "interrupt"
          : "steer";
  const submitLabel = submitMode === "start" ? "Send" : submitMode === "steer" ? "Steer" : "Stop";
  const statusMessage =
    activeTurnId === null
      ? null
      : ({
          message:
            pendingTurnId !== null
              ? "Starting a new turn and waiting for the assistant response to attach."
              : "The assistant is actively responding. Submitting again will steer the current turn.",
          variant: "default",
        } as const);

  function startNewTurn(): void {
    const submittedPrompt = composerText.trim();
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

  function steerActiveTurn(): void {
    const steeringPrompt = composerText.trim();
    if (steeringPrompt.length === 0 || activeTurnId === null) {
      return;
    }

    setEntries((currentEntries) =>
      currentEntries.map((entry) => {
        if (entry.kind !== "assistant-message" || entry.turnId !== activeTurnId) {
          return entry;
        }

        return {
          ...entry,
          status: "streaming",
          text: `${entry.text}\n\n[Steer] ${steeringPrompt}`,
        };
      }),
    );
    setComposerText("");
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

  function streamNextChunk(): void {
    if (activeTurnId === null || pendingTurnId !== null) {
      return;
    }

    const nextChunkIndex = streamChunkIndex + 1;

    setStreamChunkIndex(nextChunkIndex);
    setEntries((currentEntries) =>
      currentEntries.map((entry) => {
        if (entry.kind !== "assistant-message" || entry.turnId !== activeTurnId) {
          return entry;
        }

        return {
          ...entry,
          status: "streaming",
          text: `${entry.text}\n\n${createStreamingChunk(nextChunkIndex)}`,
        };
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
      currentEntries.map((entry) => {
        if (entry.kind !== "assistant-message" || entry.turnId !== activeTurnId) {
          return entry;
        }

        return {
          ...entry,
          status: "streaming",
          text: `${entry.text}\n\n${createLargeAssistantBlock(startingChunkIndex, chunkCount)}`,
        };
      }),
    );
  }

  function resetHarness(): void {
    setEntries(LiveHarnessSeedEntries);
    setActiveTurnId(null);
    setPendingTurnId(null);
    setComposerText("give me 2 more blurbs");
    setNextTurnIndex(1);
    setStreamChunkIndex(0);
    if (scrollContainerRef.current !== null) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }

  return (
    <SessionWorkbenchPageView
      alert={null}
      bottomPanel={<></>}
      bottomPanelSize={32}
      isBottomPanelVisible={false}
      isSecondaryPanelVisible={true}
      mainContent={
        <SessionConversationMainContent
          activeTurnId={activeTurnId}
          chatEntries={entries}
          isRespondingToServerRequest={false}
          isTurnInProgress={activeTurnId !== null}
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
      onBottomPanelResize={() => {}}
      onSecondaryPanelResize={() => {}}
      primaryBottomPanel={
        <SessionConversationBottomPanel
          chatEntries={entries}
          composerViewModel={{
            ...SessionComposerFixtureProps,
            composerText,
            isSubmitPending: pendingTurnId !== null,
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
            submitDisabled:
              pendingTurnId !== null ||
              (submitMode === "interrupt" ? false : composerText.trim().length === 0),
            submitLabel: pendingTurnId !== null ? "Sending..." : submitLabel,
            submitMode,
          }}
          isRespondingToServerRequest={false}
          onRespondToServerRequest={StorySessionConversationPaneArgs.onRespondToServerRequest}
          serverRequestPanelEntries={[]}
          showWorkingIndicator={activeTurnId !== null && pendingTurnId === null}
          statusMessage={statusMessage}
        />
      }
      sandboxInstanceId="sbi_storybook_scroll_sim"
      secondaryPanel={
        <div className="bg-background flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Live Session Simulation</p>
            <p className="text-muted-foreground text-sm leading-6">
              This harness models the real workbench surface, including pending turn ids, active
              turn ids, and the composer switching between <code>Send</code>, <code>Steer</code>,
              and <code>Stop</code>.
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
        </div>
      }
      secondaryPanelSize={28}
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
    bottomPanelSize: 28,
    isBottomPanelVisible: true,
    isSecondaryPanelVisible: false,
    mainContent: <></>,
    onBottomPanelResize: () => {},
    onSecondaryPanelResize: () => {},
    scrollBehavior: "follow-streaming-at-bottom",
    primaryBottomPanel: <></>,
    secondaryPanel: <></>,
    secondaryPanelSize: 28,
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

import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  CodexFixtureChatThreadEntries,
  CodexFixtureChatThreadEntriesWithExploringGroup,
  CodexFixtureChatThreadEntriesWithGenericItem,
  CodexFixtureChatThreadEntriesWithStructuredPlan,
  CodexFixtureChatThreadEntriesWithThinkingGroup,
} from "../../session-agents/codex/fixtures/chat-fixtures.js";
import type { ChatEntry } from "../chat-types.js";
import { noopRespondToServerRequest } from "./chat-story-support.js";
import { ChatThread } from "./chat-thread.js";

const BaseArgs = {
  isRespondingToServerRequest: false,
  onRespondToServerRequest: noopRespondToServerRequest,
  pendingServerRequests: [],
} satisfies Omit<React.ComponentProps<typeof ChatThread>, "entries">;

const ScrollPrototypeSeedEntries = [
  ...CodexFixtureChatThreadEntriesWithExploringGroup,
  ...CodexFixtureChatThreadEntriesWithThinkingGroup,
  ...CodexFixtureChatThreadEntriesWithStructuredPlan,
  ...CodexFixtureChatThreadEntriesWithGenericItem,
] satisfies readonly ChatEntry[];

const ScrollPrototypeStreamingChunks = [
  "I’m anchoring the new turn to the top edge of the chat viewport first.",
  "That leaves intentional empty space below so the streamed response can grow downward without forcing an immediate jump to the bottom.",
  "Once the response grows beyond the reserved space, normal scrolling can take over naturally.",
] as const;

function buildScrollPrototypeSeedEntries(): ChatEntry[] {
  return ScrollPrototypeSeedEntries.map((entry) => {
    if (entry.turnId === "turn-plan" && entry.kind === "assistant-message") {
      return {
        ...entry,
        turnId: "turn-plan-seed",
        id: "assistant-plan-seed-1",
      };
    }

    if (entry.turnId === "turn-plan") {
      return {
        ...entry,
        turnId: "turn-plan-seed",
        id: `${entry.id}-seed`,
      };
    }

    return entry;
  });
}

function createPrototypeTurnEntries(input: {
  turnId: string;
  userMessage: string;
  assistantText: string;
  isStreaming: boolean;
}): ChatEntry[] {
  return [
    {
      id: `${input.turnId}-user`,
      turnId: input.turnId,
      kind: "user-message",
      status: "completed",
      text: input.userMessage,
    },
    {
      id: `${input.turnId}-assistant`,
      turnId: input.turnId,
      kind: "assistant-message",
      phase: null,
      status: input.isStreaming ? "streaming" : "completed",
      text: input.assistantText,
    },
  ];
}

function measurePrototypeScrollMetrics(input: {
  activeStreamingTurnId: string | null;
  viewportElement: HTMLDivElement;
}): {
  activeTurnHeight: number;
  containerHeight: number;
  scrollTop: number;
  spacerHeight: number;
} {
  const activeTurnElement =
    input.activeStreamingTurnId === null
      ? null
      : input.viewportElement.querySelector<HTMLElement>(
          `[data-turn-id="${input.activeStreamingTurnId}"]`,
        );
  const containerHeight = input.viewportElement.clientHeight;
  const activeTurnHeight = activeTurnElement?.offsetHeight ?? 0;

  return {
    activeTurnHeight,
    containerHeight,
    scrollTop: input.viewportElement.scrollTop,
    spacerHeight:
      input.activeStreamingTurnId === null ? 0 : Math.max(0, containerHeight - activeTurnHeight),
  };
}

function alignPrototypeTurnToViewportTop(input: {
  activeStreamingTurnId: string | null;
  viewportElement: HTMLDivElement;
}): void {
  if (input.activeStreamingTurnId === null) {
    return;
  }

  const activeTurnElement = input.viewportElement.querySelector<HTMLElement>(
    `[data-turn-id="${input.activeStreamingTurnId}"]`,
  );
  if (activeTurnElement === null) {
    return;
  }

  const viewportRect = input.viewportElement.getBoundingClientRect();
  const activeTurnRect = activeTurnElement.getBoundingClientRect();
  const delta = activeTurnRect.top - viewportRect.top;
  if (Math.abs(delta) < 1) {
    return;
  }

  input.viewportElement.scrollTop += delta;
}

function ChatThreadScrollPrototype(): React.JSX.Element {
  const initialEntries = useMemo(() => buildScrollPrototypeSeedEntries(), []);
  const [entries, setEntries] = useState<readonly ChatEntry[]>(initialEntries);
  const [activeStreamingTurnId, setActiveStreamingTurnId] = useState<string | null>(null);
  const [pinnedTurnId, setPinnedTurnId] = useState<string | null>(null);
  const [submittedTurnCount, setSubmittedTurnCount] = useState(0);
  const [streamChunkCount, setStreamChunkCount] = useState(0);
  const [scrollMetrics, setScrollMetrics] = useState({
    activeTurnHeight: 0,
    containerHeight: 0,
    scrollTop: 0,
    spacerHeight: 0,
  });
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const viewportElement = viewportRef.current;
    if (viewportElement === null) {
      return;
    }
    let animationFrameId = 0;
    let nestedAnimationFrameId = 0;

    const updateMetrics = (): void => {
      alignPrototypeTurnToViewportTop({
        activeStreamingTurnId: pinnedTurnId,
        viewportElement,
      });
      setScrollMetrics(
        measurePrototypeScrollMetrics({
          activeStreamingTurnId: pinnedTurnId,
          viewportElement,
        }),
      );
    };

    updateMetrics();
    animationFrameId = requestAnimationFrame(() => {
      updateMetrics();
      nestedAnimationFrameId = requestAnimationFrame(() => {
        updateMetrics();
      });
    });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelAnimationFrame(animationFrameId);
        cancelAnimationFrame(nestedAnimationFrameId);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      updateMetrics();
    });

    resizeObserver.observe(viewportElement);
    if (pinnedTurnId !== null) {
      const activeTurnElement = viewportElement.querySelector<HTMLElement>(
        `[data-turn-id="${pinnedTurnId}"]`,
      );
      if (activeTurnElement !== null) {
        resizeObserver.observe(activeTurnElement);
      }
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      cancelAnimationFrame(nestedAnimationFrameId);
      resizeObserver.disconnect();
    };
  }, [entries, pinnedTurnId]);

  const activeSpacerHeight = scrollMetrics.spacerHeight;

  return (
    <div className="flex w-[min(100vw-3rem,72rem)] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4">
        <Button
          onClick={() => {
            const nextTurnNumber = submittedTurnCount + 1;
            const nextTurnId = `prototype-turn-${nextTurnNumber}`;
            setSubmittedTurnCount(nextTurnNumber);
            setStreamChunkCount(1);
            setActiveStreamingTurnId(nextTurnId);
            setPinnedTurnId(nextTurnId);
            setEntries((currentEntries) => [
              ...currentEntries,
              ...createPrototypeTurnEntries({
                turnId: nextTurnId,
                userMessage: `Prototype scroll turn ${nextTurnNumber}: keep the newest exchange pinned near the top while the response streams in.`,
                assistantText: ScrollPrototypeStreamingChunks[0],
                isStreaming: true,
              }),
            ]);
          }}
        >
          Send Turn
        </Button>
        <Button
          disabled={
            activeStreamingTurnId === null ||
            streamChunkCount >= ScrollPrototypeStreamingChunks.length
          }
          onClick={() => {
            if (
              activeStreamingTurnId === null ||
              streamChunkCount >= ScrollPrototypeStreamingChunks.length
            ) {
              return;
            }

            const nextChunkCount = streamChunkCount + 1;
            setStreamChunkCount(nextChunkCount);
            setEntries((currentEntries) =>
              currentEntries.map((entry) => {
                if (entry.kind !== "assistant-message" || entry.turnId !== activeStreamingTurnId) {
                  return entry;
                }

                return {
                  ...entry,
                  text: ScrollPrototypeStreamingChunks.slice(0, nextChunkCount).join("\n\n"),
                };
              }),
            );
          }}
          variant="secondary"
        >
          Stream Chunk
        </Button>
        <Button
          disabled={activeStreamingTurnId === null}
          onClick={() => {
            if (activeStreamingTurnId === null) {
              return;
            }

            setEntries((currentEntries) =>
              currentEntries.map((entry) => {
                if (entry.kind !== "assistant-message" || entry.turnId !== activeStreamingTurnId) {
                  return entry;
                }

                return {
                  ...entry,
                  status: "completed",
                  text: ScrollPrototypeStreamingChunks.join("\n\n"),
                };
              }),
            );
            setActiveStreamingTurnId(null);
          }}
          variant="secondary"
        >
          Complete Turn
        </Button>
        <Button
          onClick={() => {
            setEntries(initialEntries);
            setActiveStreamingTurnId(null);
            setPinnedTurnId(null);
            setSubmittedTurnCount(0);
            setStreamChunkCount(0);
            const viewportElement = viewportRef.current;
            if (viewportElement !== null) {
              viewportElement.scrollTop = 0;
            }
          }}
          variant="ghost"
        >
          Reset
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div
          className="rounded-[28px] border bg-stone-50 p-4 shadow-sm"
          style={{
            backgroundImage:
              "radial-gradient(circle at top, rgba(255,255,255,0.95), rgba(245,245,244,0.9) 45%, rgba(231,229,228,0.85) 100%)",
          }}
        >
          <div
            className="overflow-y-auto rounded-[22px] border bg-white px-6 py-5 shadow-inner"
            ref={viewportRef}
            style={{ height: 560 }}
          >
            <ChatThread {...BaseArgs} entries={entries} />
            {pinnedTurnId === null ? null : (
              <div
                aria-hidden="true"
                className="shrink-0"
                style={{ height: `${activeSpacerHeight}px` }}
              />
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-[24px] border bg-stone-950 p-4 text-stone-100 shadow-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-stone-400">
              Scroll Debug
            </p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-stone-400">pinnedTurnId</dt>
            <dd className="font-mono text-xs">{pinnedTurnId ?? "none"}</dd>
            <dt className="text-stone-400">scrollTop</dt>
            <dd className="font-mono text-xs">{Math.round(scrollMetrics.scrollTop)}px</dd>
            <dt className="text-stone-400">containerHeight</dt>
            <dd className="font-mono text-xs">{Math.round(scrollMetrics.containerHeight)}px</dd>
            <dt className="text-stone-400">activeTurnHeight</dt>
            <dd className="font-mono text-xs">{Math.round(scrollMetrics.activeTurnHeight)}px</dd>
            <dt className="text-stone-400">spacerHeight</dt>
            <dd className="font-mono text-xs">{Math.round(activeSpacerHeight)}px</dd>
          </dl>
          <p className="text-sm leading-6 text-stone-300">
            Use <span className="font-medium text-white">Send Turn</span> to append a new exchange,
            align it to the top of the viewport, and reserve space below for streamed output.
          </p>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Dashboard/Chat/Thread",
  component: ChatThread,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ChatThread>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    entries: CodexFixtureChatThreadEntries,
    ...BaseArgs,
  },
};

export const WithExploringGroup: Story = {
  args: {
    entries: CodexFixtureChatThreadEntriesWithExploringGroup,
    ...BaseArgs,
  },
};

export const WithThinkingGroup: Story = {
  args: {
    entries: CodexFixtureChatThreadEntriesWithThinkingGroup,
    ...BaseArgs,
  },
};

export const WithStructuredPlan: Story = {
  args: {
    entries: CodexFixtureChatThreadEntriesWithStructuredPlan,
    ...BaseArgs,
  },
};

export const WithGenericItem: Story = {
  args: {
    entries: CodexFixtureChatThreadEntriesWithGenericItem,
    ...BaseArgs,
  },
};

export const ScrollPinPrototype: Story = {
  parameters: {
    layout: "fullscreen",
  },
  render: () => <ChatThreadScrollPrototype />,
};

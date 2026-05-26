import {
  systemClock,
  systemScheduler,
  type Clock,
  type Scheduler,
  type TimerHandle,
} from "@mistle/time";
import { Notice } from "@mistle/ui";
import {
  CheckCircleIcon,
  CaretDownIcon,
  CircleIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import { useEffect, useMemo, useRef, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { sandboxOperationEventsQueryKey } from "../sessions/sessions-query-keys.js";
import { listSandboxOperationEvents } from "../sessions/sessions-service.js";
import type { SandboxOperationEvent } from "../sessions/sessions-types.js";
import { NoLoadingIndicatorMeta } from "../shared/loading-indicator-meta.js";

type SandboxOperationProgressProps = {
  displayMode?: SandboxOperationProgressDisplayMode;
  emptyMessage?: string;
  operationId: string | null;
  sandboxInstanceId: string | null;
  showBorder?: boolean | undefined;
  showLoadError?: boolean | undefined;
  title?: string | undefined;
};

type SandboxOperationProgressViewProps = {
  clock?: Clock | undefined;
  displayMode?: SandboxOperationProgressDisplayMode | undefined;
  emptyMessage?: string | undefined;
  errorMessage?: string | null | undefined;
  events: readonly SandboxOperationEvent[];
  isLoading?: boolean | undefined;
  nowMs?: number | undefined;
  scheduler?: Scheduler | undefined;
  showBorder?: boolean | undefined;
  showLoadError?: boolean | undefined;
  title?: string | undefined;
};

type SandboxOperationProgressDisplayMode = "both" | "timeline" | "stdio";

type SandboxLifecycleTimelineItem = {
  event: SandboxOperationEvent;
  phaseKey: string;
  phaseLabel: string;
  startedAt: string | null;
};

const SandboxOperationEventsLimit = 100;
const SandboxOperationEventsRefetchIntervalMs = 1_000;
const ActiveLifecycleDurationTickMs = 1_000;
const TranscriptContainerClassName = "flex max-h-72 min-h-48 flex-col overflow-hidden bg-[#111817]";
const TerminalFontFamily =
  '"JetBrains Mono Variable", "JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const OperationTerminalTheme: ITheme = {
  background: "#111817",
  foreground: "#dcebe7",
  cursor: "#dcebe7",
  cursorAccent: "#111817",
  selectionBackground: "#23433e",
  black: "#111817",
  red: "#ff8f8f",
  green: "#8fe39d",
  yellow: "#e7d37f",
  blue: "#9fc7ff",
  magenta: "#d7a8ff",
  cyan: "#89dce5",
  white: "#dcebe7",
  brightBlack: "#7f8f8b",
  brightRed: "#ffb3b3",
  brightGreen: "#b5f0bd",
  brightYellow: "#f2e4a3",
  brightBlue: "#c4dcff",
  brightMagenta: "#e6c7ff",
  brightCyan: "#b4edf2",
  brightWhite: "#f4fbf8",
};

export function SandboxOperationProgress(input: SandboxOperationProgressProps): React.JSX.Element {
  const [events, setEvents] = useState<readonly SandboxOperationEvent[]>([]);
  const afterSequence = events.length === 0 ? null : (events[events.length - 1]?.sequence ?? null);
  const sandboxInstanceId = input.sandboxInstanceId;
  const operationId = input.operationId;

  useEffect(() => {
    setEvents([]);
  }, [operationId, sandboxInstanceId]);

  const operationEventsQuery = useQuery({
    queryKey:
      sandboxInstanceId === null || operationId === null
        ? ["sandbox-operation-events", "disabled"]
        : sandboxOperationEventsQueryKey({
            afterSequence,
            operationId,
            sandboxInstanceId,
          }),
    meta: NoLoadingIndicatorMeta,
    queryFn: async ({ signal }) => {
      if (sandboxInstanceId === null || operationId === null) {
        throw new Error("Sandbox operation event identity is required.");
      }

      return listSandboxOperationEvents({
        instanceId: sandboxInstanceId,
        operationId,
        limit: SandboxOperationEventsLimit,
        ...(afterSequence === null ? {} : { afterSequence }),
        signal,
      });
    },
    enabled: sandboxInstanceId !== null && operationId !== null,
    refetchInterval: SandboxOperationEventsRefetchIntervalMs,
    retry: false,
  });

  useEffect(() => {
    const nextEvents = operationEventsQuery.data?.events ?? [];
    if (nextEvents.length === 0) {
      return;
    }

    setEvents((currentEvents) => [...currentEvents, ...nextEvents]);
  }, [operationEventsQuery.data?.events]);

  const errorMessage = operationEventsQuery.isError
    ? resolveApiErrorMessage({
        error: operationEventsQuery.error,
        fallbackMessage: "Could not load sandbox operation progress.",
      })
    : null;

  return (
    <SandboxOperationProgressView
      errorMessage={errorMessage}
      events={events}
      displayMode={input.displayMode ?? "both"}
      isLoading={operationEventsQuery.isLoading || operationEventsQuery.isFetching}
      showBorder={input.showBorder}
      showLoadError={input.showLoadError ?? true}
      title={input.title}
      {...(input.emptyMessage === undefined ? {} : { emptyMessage: input.emptyMessage })}
    />
  );
}

export function SandboxOperationProgressView(
  input: SandboxOperationProgressViewProps,
): React.JSX.Element {
  const lifecycleEvents = useMemo(
    () =>
      input.events.filter(
        (event) =>
          event.recordKind === "lifecycle" &&
          readBooleanAttribute(event.attributes, "timelineHidden") !== true,
      ),
    [input.events],
  );
  const lifecycleItems = useMemo(
    () => createLifecycleTimelineItems(lifecycleEvents),
    [lifecycleEvents],
  );
  const hasActiveLifecycleItem = lifecycleItems.some(
    (item) => item.startedAt !== null && item.event.status === "started",
  );
  const clock = input.clock ?? systemClock;
  const scheduler = input.scheduler ?? systemScheduler;
  const [liveNowMs, setLiveNowMs] = useState(() => clock.nowMs());
  useEffect(() => {
    if (!hasActiveLifecycleItem || input.nowMs !== undefined) {
      return;
    }

    let tickHandle: TimerHandle | undefined;
    let cancelled = false;
    const tick = (): void => {
      setLiveNowMs(clock.nowMs());
      if (!cancelled) {
        tickHandle = scheduler.schedule(tick, ActiveLifecycleDurationTickMs);
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (tickHandle !== undefined) {
        scheduler.cancel(tickHandle);
      }
    };
  }, [clock, hasActiveLifecycleItem, input.nowMs, scheduler]);
  const timelineNowMs = input.nowMs ?? liveNowMs;
  const transcriptEvents = useMemo(
    () =>
      input.events.filter(
        (event) =>
          event.recordKind === "transcript" &&
          (event.stream === "stdout" || event.stream === "stderr"),
      ),
    [input.events],
  );
  const displayMode = input.displayMode ?? "both";
  const shouldShowTimeline = displayMode === "both" || displayMode === "timeline";
  const shouldShowTranscript = displayMode === "both" || displayMode === "stdio";
  const contentClassName =
    displayMode === "both" ? "grid gap-0 lg:grid-cols-[minmax(16rem,0.9fr)_minmax(0,1.5fr)]" : "";
  const shouldShowHeader = input.title !== undefined;
  const shouldShowBorder = input.showBorder ?? shouldShowHeader;
  const containerClassName = shouldShowBorder
    ? "overflow-hidden rounded-md border border-border bg-background"
    : "overflow-hidden bg-background";

  return (
    <section className={containerClassName}>
      {shouldShowHeader ? (
        <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div>
            <h3 className="text-sm font-medium">{input.title}</h3>
            <p className="text-xs text-muted-foreground">
              {input.events.length === 0
                ? (input.emptyMessage ?? "Waiting for operation progress.")
                : `${String(input.events.length)} events received`}
            </p>
          </div>
          {input.isLoading === true ? (
            <SpinnerGapIcon aria-hidden className="size-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      ) : null}

      {(input.showLoadError ?? true) === false ||
      input.errorMessage === null ||
      input.errorMessage === undefined ? null : (
        <div className="border-b border-border p-3">
          <Notice title="Progress unavailable" variant="warning">
            {input.errorMessage}
          </Notice>
        </div>
      )}

      <div className={contentClassName}>
        {shouldShowTimeline ? (
          <SandboxOperationTimeline
            isSplit={displayMode === "both"}
            items={lifecycleItems}
            nowMs={timelineNowMs}
          />
        ) : null}
        {shouldShowTranscript ? <SandboxOperationTranscript events={transcriptEvents} /> : null}
      </div>
    </section>
  );
}

function SandboxOperationTimeline(input: {
  isSplit: boolean;
  items: readonly SandboxLifecycleTimelineItem[];
  nowMs: number;
}): React.JSX.Element {
  const scrollContainerRef = useRef<HTMLOListElement | null>(null);
  const [expandedItemKeys, setExpandedItemKeys] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer === null) {
      return;
    }

    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [input.items]);

  useEffect(() => {
    if (input.items.length === 0) {
      setExpandedItemKeys((currentKeys) => {
        if (currentKeys.size === 0) {
          return currentKeys;
        }

        return new Set();
      });
    }
  }, [input.items.length]);

  if (input.items.length === 0) {
    return (
      <div className={resolveTimelineContainerClassName(input.isSplit)}>
        <p className="text-sm text-muted-foreground">No lifecycle events yet.</p>
      </div>
    );
  }

  return (
    <ol
      className={`${resolveTimelineContainerClassName(input.isSplit)} space-y-2`}
      ref={scrollContainerRef}
    >
      {input.items.map(({ event, phaseKey, phaseLabel, startedAt }) => {
        const diagnosticMessage = resolveLifecycleDiagnosticMessage(event);
        const isExpanded = expandedItemKeys.has(phaseKey);
        const duration = formatLifecycleItemDuration({ event, nowMs: input.nowMs, startedAt });

        return (
          <li className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-2" key={phaseKey}>
            <span className="pt-0.5">{renderStatusIcon(event.status)}</span>
            <div className="min-w-0">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium">{phaseLabel}</span>
                <span className="sr-only">Status: {formatLifecycleStatus(event.status)}</span>
                {duration === null ? null : (
                  <time className="text-xs text-muted-foreground" dateTime={duration.dateTime}>
                    {duration.label}
                  </time>
                )}
                {diagnosticMessage === null ? null : (
                  <button
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? "Hide" : "Show"} ${phaseLabel} details`}
                    className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    onClick={() => {
                      setExpandedItemKeys((currentKeys) =>
                        toggleExpandedTimelineItemKey(currentKeys, phaseKey),
                      );
                    }}
                    type="button"
                  >
                    <CaretDownIcon
                      aria-hidden
                      className={`size-3.5 transition-transform ${isExpanded ? "" : "-rotate-90"}`}
                    />
                  </button>
                )}
              </span>
              {diagnosticMessage === null || !isExpanded ? null : (
                <p className="mt-1 whitespace-pre-wrap break-words rounded border border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                  {diagnosticMessage}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function toggleExpandedTimelineItemKey(
  currentKeys: ReadonlySet<string>,
  itemKey: string,
): ReadonlySet<string> {
  const nextKeys = new Set(currentKeys);
  if (nextKeys.has(itemKey)) {
    nextKeys.delete(itemKey);
  } else {
    nextKeys.add(itemKey);
  }
  return nextKeys;
}

function SandboxOperationTranscript(input: {
  events: readonly SandboxOperationEvent[];
}): React.JSX.Element {
  const outputChunks = useMemo(
    () => input.events.map((event) => decodeTranscriptPayload(event)),
    [input.events],
  );

  if (outputChunks.length === 0) {
    return (
      <div className={TranscriptContainerClassName}>
        <SandboxOperationTranscriptHeader />
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <p className="font-mono text-xs text-[#8fa09c]">No output yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={TranscriptContainerClassName}>
      <SandboxOperationTranscriptHeader />
      <SandboxOperationTranscriptTerminal outputChunks={outputChunks} />
    </div>
  );
}

function SandboxOperationTranscriptTerminal(input: {
  outputChunks: readonly Uint8Array[];
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastRenderedChunkCountRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: false,
      cursorInactiveStyle: "none",
      disableStdin: true,
      fontFamily: TerminalFontFamily,
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 2_000,
      theme: OperationTerminalTheme,
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    lastRenderedChunkCountRef.current = 0;
    fitAddon.fit();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            fitAddon.fit();
          });

    resizeObserver?.observe(container);

    return () => {
      resizeObserver?.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      lastRenderedChunkCountRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal === null) {
      return;
    }

    const nextChunkCount = input.outputChunks.length;
    if (nextChunkCount < lastRenderedChunkCountRef.current) {
      terminal.reset();
      lastRenderedChunkCountRef.current = 0;
    }

    const nextChunks = input.outputChunks.slice(lastRenderedChunkCountRef.current);
    for (const chunk of nextChunks) {
      terminal.write(chunk);
    }
    fitAddonRef.current?.fit();
    terminal.scrollToBottom();

    lastRenderedChunkCountRef.current = nextChunkCount;
  }, [input.outputChunks]);

  return (
    <div
      aria-label="Terminal output"
      className="min-h-0 flex-1 overflow-hidden px-3 py-2 [&_.xterm]:h-full [&_.xterm-viewport]:overflow-y-auto"
      ref={containerRef}
    />
  );
}

function SandboxOperationTranscriptHeader(): React.JSX.Element {
  return (
    <div className="border-b border-white/10 px-3 py-2">
      <p className="text-xs font-medium text-[#dcebe7]">Terminal output</p>
    </div>
  );
}

function resolveTimelineContainerClassName(isSplit: boolean): string {
  return isSplit
    ? "max-h-72 min-h-48 overflow-auto border-b border-border p-3 lg:border-r lg:border-b-0"
    : "max-h-72 min-h-48 overflow-auto p-3";
}

function createLifecycleTimelineItems(
  events: readonly SandboxOperationEvent[],
): SandboxLifecycleTimelineItem[] {
  const items: SandboxLifecycleTimelineItem[] = [];
  const itemIndexesByPhase = new Map<string, number>();

  for (const event of events) {
    const phaseKey = resolveLifecycleTimelineKey(event);
    const existingIndex = itemIndexesByPhase.get(phaseKey);
    if (existingIndex === undefined) {
      itemIndexesByPhase.set(phaseKey, items.length);
      items.push({
        event,
        phaseKey,
        phaseLabel: resolveLifecycleTimelineLabel(event),
        startedAt: event.status === "started" ? event.observedAt : null,
      });
      continue;
    }

    const existingItem = items[existingIndex];
    if (existingItem === undefined) {
      throw new Error("Lifecycle timeline phase index was missing.");
    }

    const nextEvent = resolveLifecycleTimelineEvent(existingItem.event, event);
    items[existingIndex] = {
      event: nextEvent,
      phaseKey: existingItem.phaseKey,
      phaseLabel: resolveLifecycleTimelineLabel(nextEvent),
      startedAt:
        nextEvent.status === "started"
          ? nextEvent.observedAt
          : (existingItem.startedAt ?? (event.status === "started" ? event.observedAt : null)),
    };
  }

  return items;
}

function resolveLifecycleTimelineKey(event: SandboxOperationEvent): string {
  const displayKey = readStringAttribute(event.attributes, "timelineKey")?.trim();
  if (displayKey !== undefined && displayKey.length > 0) {
    return displayKey;
  }

  return event.phase ?? "operation";
}

function resolveLifecycleTimelineLabel(event: SandboxOperationEvent): string {
  const displayLabel = readStringAttribute(event.attributes, "timelineLabel")?.trim();
  if (displayLabel !== undefined && displayLabel.length > 0) {
    return displayLabel;
  }

  return formatLifecyclePhase(event.phase);
}

function readBooleanAttribute(
  attributes: SandboxOperationEvent["attributes"],
  key: string,
): boolean | undefined {
  if (
    attributes === null ||
    typeof attributes !== "object" ||
    Array.isArray(attributes) ||
    !(key in attributes)
  ) {
    return undefined;
  }

  const value = attributes[key];
  return typeof value === "boolean" ? value : undefined;
}

function resolveLifecycleTimelineEvent(
  currentEvent: SandboxOperationEvent,
  nextEvent: SandboxOperationEvent,
): SandboxOperationEvent {
  if (currentEvent.status === "completed" && nextEvent.status === "started") {
    return currentEvent;
  }

  return nextEvent;
}

function renderStatusIcon(status: SandboxOperationEvent["status"]): React.JSX.Element {
  if (status === "completed") {
    return (
      <CheckCircleIcon
        aria-hidden
        className="size-4 text-emerald-600 dark:text-emerald-400"
        weight="fill"
      />
    );
  }

  if (status === "failed") {
    return <XCircleIcon aria-hidden className="size-4 text-destructive" weight="fill" />;
  }

  if (status === "warning") {
    return <WarningCircleIcon aria-hidden className="size-4 text-amber-700" weight="fill" />;
  }

  if (status === "started") {
    return <SpinnerGapIcon aria-hidden className="size-4 animate-spin text-muted-foreground" />;
  }

  return <CircleIcon aria-hidden className="size-4 text-muted-foreground" />;
}

function formatLifecyclePhase(phase: SandboxOperationEvent["phase"]): string {
  if (phase === null) {
    return "Operation";
  }

  switch (phase) {
    case "agent_endpoint":
      return "Agent endpoint";
    case "egress":
      return "Egress";
    case "git_identity":
      return "Git identity";
    case "operation_stream":
      return "Tunnel";
    case "provider":
      return "Sandbox";
    case "ready":
      return "Ready";
    case "running":
      return "Running";
    case "runtime_adapters":
      return "Runtime adapters";
    case "runtime_plan":
      return "Runtime plan";
    case "runtime_processes":
      return "Runtime processes";
    case "sandboxd":
      return "Sandbox daemon";
    case "setup_script":
      return "Setup script";
    case "snapshot":
      return "Snapshot";
    case "stop":
      return "Stop";
    case "storage_attach":
      return "Storage attach";
    case "storage_provision":
      return "Storage provision";
    case "teardown":
      return "Teardown";
  }
}

function formatLifecycleStatus(status: SandboxOperationEvent["status"]): string {
  if (status === null) {
    return "event";
  }

  return status.replaceAll("_", " ");
}

function resolveLifecycleDiagnosticMessage(event: SandboxOperationEvent): string | null {
  if (event.status !== "failed" && event.status !== "warning") {
    return null;
  }

  const message = event.message.trim();
  const error = readStringAttribute(event.attributes, "error")?.trim() ?? "";

  if (message.length === 0) {
    return error.length === 0 ? null : error;
  }

  if (error.length === 0 || error === message) {
    return message;
  }

  return `${message}\n${error}`;
}

function readStringAttribute(attributes: Record<string, unknown>, key: string): string | undefined {
  const value = attributes[key];
  return typeof value === "string" ? value : undefined;
}

function formatLifecycleItemDuration(input: {
  event: SandboxOperationEvent;
  nowMs: number;
  startedAt: string | null;
}): { dateTime: string; label: string } | null {
  if (input.startedAt === null) {
    return null;
  }

  const startedAtMs = new Date(input.startedAt).valueOf();
  const endedAtMs =
    input.event.status === "started" ? input.nowMs : new Date(input.event.observedAt).valueOf();
  if (Number.isNaN(startedAtMs) || Number.isNaN(endedAtMs)) {
    return null;
  }

  const durationMs = endedAtMs - startedAtMs;
  if (durationMs < 0) {
    return null;
  }

  return {
    dateTime: formatDurationDateTime(durationMs),
    label: formatDurationLabel(durationMs),
  };
}

function formatDurationLabel(durationMs: number): string {
  if (durationMs < 1_000) {
    return "<1s";
  }

  const totalSeconds = Math.round(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours)}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }

  if (minutes > 0) {
    return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${String(seconds)}s`;
}

function formatDurationDateTime(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `PT${String(hours)}H${String(minutes)}M${String(seconds)}S`;
}

function decodeTranscriptPayload(event: SandboxOperationEvent): Uint8Array {
  if (event.payloadBase64 === null) {
    throw new Error(`Transcript operation event '${event.id}' is missing payloadBase64.`);
  }

  const binary = window.atob(event.payloadBase64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

import {
  cn,
  type PanelImperativeHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Notice,
  Spinner,
  useDefaultLayout,
} from "@mistle/ui";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  getBestEffortBrowserStorage,
  readBrowserStorageItem,
  writeBrowserStorageItem,
} from "../shared/browser-storage.js";

import "./session-workbench-page-view.css";
import { MIN_TERMINAL_PANEL_SIZE } from "./use-session-terminal-workbench-state.js";

const MainPanelGroupIdPrefix = "dashboard:session-workbench:main";
const MainWorkspacePanelId = "session-workbench-main-workspace-panel";
const BottomPanelId = "session-workbench-bottom-panel";
const PrimaryPanelId = "session-workbench-primary-panel";
const SecondaryPanelId = "session-workbench-secondary-panel";
const DefaultTerminalPanelHeightPx = 320;
const ResizablePanelStorageKeyPrefix = "react-resizable-panels:";

type SessionWorkbenchSecondaryPanelMountMode = "visible-only" | "persistent-collapsible";
type PanelDefaultLayout = Record<string, number>;

type SessionWorkbenchAlert = {
  title: string;
  description: string;
  variant?: "alert" | "default";
};

type SessionWorkbenchMainContentLayout = {
  scroll: "contained" | "page";
  width: "chat" | "full";
};

type SessionWorkbenchPageViewProps = {
  sandboxInstanceId: string | null;
  alert: SessionWorkbenchAlert | null;
  isPrimaryPanelTransitioning?: boolean;
  mainContentAriaLabel?: string;
  mainContentLayout?: SessionWorkbenchMainContentLayout;
  mainContentScrollbarGutter?: "stable" | "stable both-edges";
  mainContentScrollContainerRef?: React.Ref<HTMLDivElement>;
  primaryPanelDefaultSize?: number;
  secondaryPanelDefaultSize?: number;
  secondaryPanelLayoutKey?: string;
  secondaryPanelMinSize?: string;
  secondaryPanelMountMode?: SessionWorkbenchSecondaryPanelMountMode;
  primaryPanelMinSize?: string;
  mainContent: React.ReactNode;
  primaryBottomPanel: React.ReactNode;
  isPrimaryBottomPanelVisible?: boolean;
  bottomPanel: React.ReactNode;
  isBottomPanelVisible: boolean;
  secondaryPanel: React.ReactNode;
  isSecondaryPanelVisible: boolean;
};

export type {
  SessionWorkbenchAlert,
  SessionWorkbenchMainContentLayout,
  SessionWorkbenchPageViewProps,
};

export function SessionWorkbenchPageView({
  sandboxInstanceId,
  alert,
  isPrimaryPanelTransitioning = false,
  mainContentAriaLabel = "Conversation chat",
  mainContentLayout = { scroll: "page", width: "chat" },
  mainContentScrollbarGutter,
  mainContentScrollContainerRef,
  primaryPanelDefaultSize,
  secondaryPanelDefaultSize,
  secondaryPanelLayoutKey = "default",
  secondaryPanelMinSize = "20%",
  secondaryPanelMountMode = "visible-only",
  primaryPanelMinSize = "25%",
  mainContent,
  primaryBottomPanel,
  isPrimaryBottomPanelVisible,
  bottomPanel,
  isBottomPanelVisible,
  secondaryPanel,
  isSecondaryPanelVisible,
}: SessionWorkbenchPageViewProps): React.JSX.Element {
  const [isSecondaryPanelTransitioning, setSecondaryPanelTransitioning] = useState(false);
  const bottomPanelRef = useRef<PanelImperativeHandle | null>(null);
  const secondaryPanelRef = useRef<PanelImperativeHandle | null>(null);
  const hasAppliedBottomPanelVisibilityRef = useRef(false);
  const hasAppliedSecondaryPanelVisibilityRef = useRef(false);
  const initialStoredLayoutByGroupRef = useRef(new Map<string, boolean>());
  const previousBottomPanelVisibilityRef = useRef<boolean | null>(null);
  const previousBottomPanelGroupKeyRef = useRef<string | null>(null);
  const previousSecondaryPanelVisibilityRef = useRef<boolean | null>(null);
  const sandboxInstanceKey = sandboxInstanceId ?? "missing-session";
  const isSecondaryPanelMounted =
    isSecondaryPanelVisible || secondaryPanelMountMode === "persistent-collapsible";
  const mainPanelGroupId = `${MainPanelGroupIdPrefix}:${sandboxInstanceKey}:${secondaryPanelLayoutKey}`;
  const mainPanelIds = isSecondaryPanelMounted
    ? [PrimaryPanelId, SecondaryPanelId]
    : [PrimaryPanelId];
  const mainPanelGroupRenderKey = `${sandboxInstanceKey}:${secondaryPanelLayoutKey}`;
  const ignoredCollapsedPanelId =
    secondaryPanelMountMode === "persistent-collapsible" ? SecondaryPanelId : undefined;
  const layoutStorage = {
    getItem(key: string): string | null {
      return readBrowserStorageItem({
        key,
        storage: getBestEffortBrowserStorage("local"),
      });
    },
    setItem(key: string, value: string): void {
      if (
        secondaryPanelMountMode === "persistent-collapsible" &&
        !isSecondaryPanelVisible &&
        key === getResizablePanelStorageKey({ id: mainPanelGroupId, panelIds: mainPanelIds })
      ) {
        return;
      }

      writeBrowserStorageItem({
        key,
        value,
        storage: getBestEffortBrowserStorage("local"),
      });
    },
  } satisfies Pick<Storage, "getItem" | "setItem">;
  const mainPanelLayoutPersistence = useDefaultLayout({
    id: mainPanelGroupId,
    panelIds: mainPanelIds,
    storage: layoutStorage,
  });
  const hasInitialStoredMainPanelLayout = readInitialStoredPanelLayout({
    cache: initialStoredLayoutByGroupRef.current,
    id: mainPanelGroupId,
    ignoredCollapsedPanelId,
    panelIds: mainPanelIds,
    storage: layoutStorage,
  });
  const mainPanelDefaultLayout = resolveMainPanelDefaultLayout({
    defaultLayout: mainPanelLayoutPersistence.defaultLayout,
    isSecondaryPanelMounted,
    primaryPanelDefaultSize,
    secondaryPanelDefaultSize,
    hasStoredLayout: hasStoredResizablePanelLayout({
      id: mainPanelGroupId,
      ignoredCollapsedPanelId,
      panelIds: mainPanelIds,
      storage: layoutStorage,
    }),
  });
  const handleMainPanelTransitionEnd = useCallback((event: React.TransitionEvent) => {
    if (!isResizablePanelTransitionEnd(event)) {
      return;
    }

    setSecondaryPanelTransitioning(false);
  }, []);

  useLayoutEffect(() => {
    const bottomPanel = bottomPanelRef.current;
    if (bottomPanel === null) {
      return;
    }

    const wasBottomPanelVisible = previousBottomPanelVisibilityRef.current;
    const previousBottomPanelGroupKey = previousBottomPanelGroupKeyRef.current;
    previousBottomPanelVisibilityRef.current = isBottomPanelVisible;
    previousBottomPanelGroupKeyRef.current = mainPanelGroupRenderKey;

    if (
      hasAppliedBottomPanelVisibilityRef.current &&
      wasBottomPanelVisible === isBottomPanelVisible &&
      previousBottomPanelGroupKey === mainPanelGroupRenderKey
    ) {
      return;
    }
    hasAppliedBottomPanelVisibilityRef.current = true;

    if (!isBottomPanelVisible) {
      bottomPanel.collapse();
      return;
    }

    bottomPanel.expand();
    if (wasBottomPanelVisible !== true) {
      bottomPanel.resize(`${String(DefaultTerminalPanelHeightPx)}px`);
    }
  }, [isBottomPanelVisible, mainPanelGroupRenderKey]);

  useLayoutEffect(() => {
    if (secondaryPanelMountMode !== "persistent-collapsible") {
      return;
    }

    const secondaryPanelHandle = secondaryPanelRef.current;
    if (secondaryPanelHandle === null) {
      return;
    }

    const wasSecondaryPanelVisible = previousSecondaryPanelVisibilityRef.current;
    previousSecondaryPanelVisibilityRef.current = isSecondaryPanelVisible;

    if (
      hasAppliedSecondaryPanelVisibilityRef.current &&
      wasSecondaryPanelVisible === isSecondaryPanelVisible
    ) {
      return;
    }
    hasAppliedSecondaryPanelVisibilityRef.current = true;
    if (wasSecondaryPanelVisible !== null) {
      setSecondaryPanelTransitioning(true);
    }

    if (!isSecondaryPanelVisible) {
      secondaryPanelHandle.collapse();
      return;
    }

    secondaryPanelHandle.expand();
    if (
      wasSecondaryPanelVisible === true ||
      hasInitialStoredMainPanelLayout ||
      hasStoredResizablePanelLayout({
        id: mainPanelGroupId,
        ignoredCollapsedPanelId,
        panelIds: mainPanelIds,
        storage: layoutStorage,
      }) ||
      secondaryPanelDefaultSize === undefined
    ) {
      return;
    }

    const resizeFrame = resizePanelToPercentageOnNextFrame({
      percentage: secondaryPanelDefaultSize,
      panel: secondaryPanelHandle,
    });
    return () => {
      window.cancelAnimationFrame(resizeFrame);
    };
  }, [
    hasInitialStoredMainPanelLayout,
    ignoredCollapsedPanelId,
    isSecondaryPanelVisible,
    mainPanelGroupId,
    secondaryPanelDefaultSize,
    secondaryPanelMountMode,
  ]);

  if (sandboxInstanceId === null) {
    return (
      <Notice title="Session id is missing" variant="alert">
        Open a session from the Sessions page.
      </Notice>
    );
  }

  const hasPrimaryBottomPanel =
    primaryBottomPanel !== null && primaryBottomPanel !== undefined && primaryBottomPanel !== false;
  const shouldShowPrimaryBottomPanel = isPrimaryBottomPanelVisible ?? hasPrimaryBottomPanel;
  const mainContentContainerClassName =
    mainContentLayout.width === "full" ? "h-full w-full" : "mx-auto w-full max-w-3xl px-4 pb-4";
  const mainContentRegionClassName =
    mainContentLayout.scroll === "contained"
      ? "min-h-0 flex-1 overflow-hidden"
      : "min-h-0 flex-1 overflow-y-auto";
  const resolvedMainContentScrollbarGutter =
    mainContentScrollbarGutter ??
    (mainContentLayout.width === "full" ? undefined : "stable both-edges");
  const mainContentScrollbarGutterStyle =
    resolvedMainContentScrollbarGutter === undefined
      ? undefined
      : { scrollbarGutter: resolvedMainContentScrollbarGutter };
  const primaryPanelTransitionClassName = isPrimaryPanelTransitioning
    ? "opacity-0 transition-opacity duration-200 ease-out"
    : "opacity-100 transition-opacity duration-200 ease-in";
  const mainWorkspaceContent = (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div
        aria-label={mainContentAriaLabel}
        className={mainContentRegionClassName}
        ref={mainContentScrollContainerRef}
        role="region"
        style={mainContentScrollbarGutterStyle}
      >
        <div className={mainContentContainerClassName}>{mainContent}</div>
      </div>

      {!hasPrimaryBottomPanel ? null : (
        <div
          className={[
            "bg-background/95 flex-none pt-3 pb-4 backdrop-blur-sm",
            shouldShowPrimaryBottomPanel ? null : "hidden",
          ].join(" ")}
        >
          <div className="mx-auto w-full max-w-3xl px-4">{primaryBottomPanel}</div>
        </div>
      )}
    </div>
  );
  const mainWorkspace = (
    <div className={`flex h-full min-h-0 overflow-hidden ${primaryPanelTransitionClassName}`}>
      {mainWorkspaceContent}
    </div>
  );
  const workspaceWithBottomPanel = (
    <ResizablePanelGroup
      className="min-h-0 h-full"
      orientation="vertical"
      resizeTargetMinimumSize={{ coarse: 36, fine: 18 }}
    >
      <ResizablePanel id={MainWorkspacePanelId} minSize="40%">
        {mainWorkspace}
      </ResizablePanel>
      <ResizableHandle
        className={
          isBottomPanelVisible
            ? "relative -my-1 shrink-0 bg-transparent aria-orientation-horizontal:!h-3 aria-orientation-horizontal:cursor-row-resize after:absolute after:inset-x-0 after:top-1/2 after:-translate-y-1/2 after:bg-border hover:after:bg-muted-foreground/50 aria-orientation-horizontal:after:h-px"
            : "hidden"
        }
      />
      <ResizablePanel
        collapsedSize={0}
        collapsible
        defaultSize={isBottomPanelVisible ? undefined : 0}
        id={BottomPanelId}
        minSize={`${String(MIN_TERMINAL_PANEL_SIZE)}px`}
        panelRef={bottomPanelRef}
      >
        <div className="bg-background/98 h-full min-h-0 overflow-hidden backdrop-blur-sm">
          <div className="h-full w-full">{bottomPanel}</div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {alert === null ? null : (
        <div className="mx-auto flex w-full max-w-3xl flex-none flex-col gap-4 px-4 py-6">
          <Notice
            aria-live={alert.variant === "default" ? "polite" : undefined}
            key={`${alert.title}:${alert.description}`}
            role={alert.variant === "default" ? "status" : undefined}
            title={alert.title}
            variant={alert.variant ?? "alert"}
            icon={
              alert.variant === "default" ? (
                <Spinner aria-hidden className="size-4 shrink-0" />
              ) : undefined
            }
          >
            {alert.description}
          </Notice>
        </div>
      )}

      <ResizablePanelGroup
        className={cn(
          "min-h-0 flex-1",
          isSecondaryPanelTransitioning ? "session-workbench-main-group-animated" : null,
        )}
        defaultLayout={mainPanelDefaultLayout}
        id="session-workbench-main-group"
        key={mainPanelGroupRenderKey}
        onLayoutChanged={mainPanelLayoutPersistence.onLayoutChanged}
        onTransitionEnd={handleMainPanelTransitionEnd}
        orientation="horizontal"
      >
        <ResizablePanel
          defaultSize={formatResizablePanelPercentage(primaryPanelDefaultSize)}
          id={PrimaryPanelId}
          minSize={primaryPanelMinSize}
        >
          {workspaceWithBottomPanel}
        </ResizablePanel>
        {!isSecondaryPanelMounted ? null : (
          <>
            <ResizableHandle
              className={isSecondaryPanelVisible ? undefined : "hidden"}
              id="session-workbench-secondary-handle"
            />
            <ResizablePanel
              collapsedSize={0}
              collapsible={secondaryPanelMountMode === "persistent-collapsible"}
              defaultSize={formatResizablePanelPercentage(secondaryPanelDefaultSize)}
              id={SecondaryPanelId}
              minSize={secondaryPanelMinSize}
              panelRef={secondaryPanelRef}
            >
              <div
                aria-hidden={!isSecondaryPanelVisible}
                className="bg-background/98 h-full min-h-0 overflow-hidden backdrop-blur-sm"
                inert={!isSecondaryPanelVisible ? true : undefined}
              >
                <div className="h-full w-full">{secondaryPanel}</div>
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

function hasStoredResizablePanelLayout(input: {
  id: string;
  ignoredCollapsedPanelId: string | undefined;
  panelIds: readonly string[];
  storage: Pick<Storage, "getItem">;
}): boolean {
  const currentStorageKey = getResizablePanelStorageKey({
    id: input.id,
    panelIds: input.panelIds,
  });
  const currentStoredValue = input.storage.getItem(currentStorageKey);
  if (
    currentStoredValue !== null &&
    isStoredPanelLayoutObject({
      ignoredCollapsedPanelId: input.ignoredCollapsedPanelId,
      value: currentStoredValue,
    })
  ) {
    return true;
  }

  const legacyStorageKey = getResizablePanelStorageKey({
    id: input.id,
    panelIds: [],
  });
  const legacyStoredValue = input.storage.getItem(legacyStorageKey);
  if (legacyStoredValue === null) {
    return false;
  }

  const legacyStoredLayout = parseJsonRecord(legacyStoredValue);
  if (legacyStoredLayout === null) {
    return false;
  }

  const legacyPanelLayout = legacyStoredLayout[input.panelIds.join(",")];
  if (!isRecord(legacyPanelLayout)) {
    return false;
  }

  const layout = legacyPanelLayout.layout;
  if (
    !Array.isArray(layout) ||
    layout.length !== input.panelIds.length ||
    !layout.every((value) => typeof value === "number")
  ) {
    return false;
  }

  if (input.ignoredCollapsedPanelId === undefined) {
    return true;
  }

  const ignoredPanelIndex = input.panelIds.indexOf(input.ignoredCollapsedPanelId);
  if (ignoredPanelIndex < 0) {
    return true;
  }

  return layout[ignoredPanelIndex] !== 0;
}

function resolveMainPanelDefaultLayout(input: {
  defaultLayout: PanelDefaultLayout | undefined;
  hasStoredLayout: boolean;
  isSecondaryPanelMounted: boolean;
  primaryPanelDefaultSize: number | undefined;
  secondaryPanelDefaultSize: number | undefined;
}): PanelDefaultLayout | undefined {
  const explicitDefaultLayout = createExplicitMainPanelDefaultLayout(input);
  if (explicitDefaultLayout !== undefined && !input.hasStoredLayout) {
    return explicitDefaultLayout;
  }

  return input.defaultLayout;
}

function createExplicitMainPanelDefaultLayout(input: {
  isSecondaryPanelMounted: boolean;
  primaryPanelDefaultSize: number | undefined;
  secondaryPanelDefaultSize: number | undefined;
}): PanelDefaultLayout | undefined {
  if (
    input.primaryPanelDefaultSize === undefined ||
    input.secondaryPanelDefaultSize === undefined ||
    !input.isSecondaryPanelMounted
  ) {
    return undefined;
  }

  return {
    [PrimaryPanelId]: input.primaryPanelDefaultSize,
    [SecondaryPanelId]: input.secondaryPanelDefaultSize,
  };
}

function readInitialStoredPanelLayout(input: {
  cache: Map<string, boolean>;
  id: string;
  ignoredCollapsedPanelId: string | undefined;
  panelIds: readonly string[];
  storage: Pick<Storage, "getItem">;
}): boolean {
  const cacheKey = getResizablePanelStorageKey({
    id: input.id,
    panelIds: input.panelIds,
  });
  const cachedValue = input.cache.get(cacheKey);
  if (cachedValue !== undefined) {
    return cachedValue;
  }

  const hasStoredLayout = hasStoredResizablePanelLayout(input);
  input.cache.set(cacheKey, hasStoredLayout);
  return hasStoredLayout;
}

function resizePanelToPercentageOnNextFrame(input: {
  panel: PanelImperativeHandle;
  percentage: number;
}): number {
  return window.requestAnimationFrame(() => {
    input.panel.resize(formatResizablePanelPercentage(input.percentage));
  });
}

function formatResizablePanelPercentage(percentage: number): string;
function formatResizablePanelPercentage(percentage: undefined): undefined;
function formatResizablePanelPercentage(percentage: number | undefined): string | undefined;
function formatResizablePanelPercentage(percentage: number | undefined): string | undefined {
  if (percentage === undefined) {
    return undefined;
  }

  return `${String(percentage)}%`;
}

function isResizablePanelTransitionEnd(event: React.TransitionEvent): boolean {
  return (
    event.target instanceof HTMLElement &&
    event.target.hasAttribute("data-panel") &&
    event.propertyName.startsWith("flex")
  );
}

function getResizablePanelStorageKey(input: { id: string; panelIds: readonly string[] }): string {
  return `${ResizablePanelStorageKeyPrefix}${[input.id, ...input.panelIds].join(":")}`;
}

function isStoredPanelLayoutObject(input: {
  ignoredCollapsedPanelId: string | undefined;
  value: string;
}): boolean {
  const parsedValue = parseJsonRecord(input.value);
  if (
    input.ignoredCollapsedPanelId !== undefined &&
    parsedValue?.[input.ignoredCollapsedPanelId] === 0
  ) {
    return false;
  }

  return (
    parsedValue !== null && Object.values(parsedValue).every((item) => typeof item === "number")
  );
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsedValue: unknown = JSON.parse(value);
    return isRecord(parsedValue) ? parsedValue : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

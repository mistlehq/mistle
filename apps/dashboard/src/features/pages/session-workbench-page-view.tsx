import {
  type PanelImperativeHandle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Notice,
} from "@mistle/ui";
import { useLayoutEffect, useRef } from "react";

import { MIN_TERMINAL_PANEL_SIZE } from "./use-session-terminal-workbench-state.js";

type SessionWorkbenchAlert = {
  title: string;
  description: string;
};

type SessionWorkbenchMainContentLayout = {
  scroll: "contained" | "page";
  width: "chat" | "full";
};

type SessionWorkbenchPageViewProps = {
  sandboxInstanceId: string | null;
  alert: SessionWorkbenchAlert | null;
  isPrimaryPanelTransitioning?: boolean;
  mainContentLayout?: SessionWorkbenchMainContentLayout;
  mainContentScrollContainerRef?: React.Ref<HTMLDivElement>;
  mainContent: React.ReactNode;
  primaryBottomPanel: React.ReactNode;
  bottomPanel: React.ReactNode;
  bottomPanelSize: number;
  onBottomPanelResize: (size: number) => void;
  isBottomPanelVisible: boolean;
  secondaryPanel: React.ReactNode;
  secondaryPanelSize: number;
  onSecondaryPanelResize: (size: number) => void;
  isSecondaryPanelVisible: boolean;
};

export type {
  SessionWorkbenchAlert,
  SessionWorkbenchMainContentLayout,
  SessionWorkbenchPageViewProps,
};

function resolveBottomPanelDefaultSizes(input: {
  bottomPanelSize: number;
  isBottomPanelVisible: boolean;
}): {
  bottomPanelDefaultSize: string;
  mainPanelDefaultSize?: number | string;
} {
  if (!input.isBottomPanelVisible) {
    return {
      bottomPanelDefaultSize: "0px",
      mainPanelDefaultSize: "100%",
    };
  }

  return {
    bottomPanelDefaultSize: `${String(input.bottomPanelSize)}px`,
  };
}

export function SessionWorkbenchPageView({
  sandboxInstanceId,
  alert,
  isPrimaryPanelTransitioning = false,
  mainContentLayout = { scroll: "page", width: "chat" },
  mainContentScrollContainerRef,
  mainContent,
  primaryBottomPanel,
  bottomPanel,
  bottomPanelSize,
  onBottomPanelResize,
  isBottomPanelVisible,
  secondaryPanel,
  secondaryPanelSize,
  onSecondaryPanelResize,
  isSecondaryPanelVisible,
}: SessionWorkbenchPageViewProps): React.JSX.Element {
  const bottomPanelRef = useRef<PanelImperativeHandle | null>(null);
  const hasAppliedBottomPanelVisibilityRef = useRef(false);
  const previousBottomPanelVisibilityRef = useRef<boolean | null>(null);
  const bottomPanelDefaultSizes = resolveBottomPanelDefaultSizes({
    bottomPanelSize,
    isBottomPanelVisible,
  });

  useLayoutEffect(() => {
    const bottomPanel = bottomPanelRef.current;
    if (bottomPanel === null) {
      return;
    }

    const wasBottomPanelVisible = previousBottomPanelVisibilityRef.current;
    previousBottomPanelVisibilityRef.current = isBottomPanelVisible;

    if (
      hasAppliedBottomPanelVisibilityRef.current &&
      wasBottomPanelVisible === isBottomPanelVisible
    ) {
      return;
    }
    hasAppliedBottomPanelVisibilityRef.current = true;

    if (!isBottomPanelVisible) {
      bottomPanel.collapse();
      return;
    }

    bottomPanel.expand();
  }, [isBottomPanelVisible]);

  if (sandboxInstanceId === null) {
    return (
      <Notice title="Session id is missing" variant="alert">
        Open a session from the Sessions page.
      </Notice>
    );
  }

  const hasPrimaryBottomPanel =
    primaryBottomPanel !== null && primaryBottomPanel !== undefined && primaryBottomPanel !== false;
  const mainContentContainerClassName =
    mainContentLayout.width === "full"
      ? "h-full w-full"
      : "mx-auto w-full max-w-3xl pr-2 pb-4 md:px-4";
  const mainContentRegionClassName =
    mainContentLayout.scroll === "contained"
      ? "min-h-0 flex-1 overflow-hidden"
      : "min-h-0 flex-1 overflow-y-auto";
  const mainContentScrollbarGutterStyle =
    mainContentLayout.width === "full" ? undefined : { scrollbarGutter: "stable both-edges" };
  const primaryPanelTransitionClassName = isPrimaryPanelTransitioning
    ? "opacity-0 transition-opacity duration-200 ease-out"
    : "opacity-100 transition-opacity duration-200 ease-in";
  const mainWorkspace = (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden ${primaryPanelTransitionClassName}`}
    >
      <div
        aria-label="Conversation chat"
        className={mainContentRegionClassName}
        ref={mainContentScrollContainerRef}
        role="region"
        style={mainContentScrollbarGutterStyle}
      >
        <div className={mainContentContainerClassName}>{mainContent}</div>
      </div>

      {!hasPrimaryBottomPanel ? null : (
        <div className="bg-background/95 flex-none pt-3 pb-4 backdrop-blur-sm">
          <div className="mx-auto w-full max-w-3xl px-4">{primaryBottomPanel}</div>
        </div>
      )}
    </div>
  );
  const workspaceWithBottomPanel = (
    <ResizablePanelGroup
      className="min-h-0 h-full"
      orientation="vertical"
      resizeTargetMinimumSize={{ coarse: 36, fine: 18 }}
    >
      <ResizablePanel
        minSize="40%"
        {...(bottomPanelDefaultSizes.mainPanelDefaultSize === undefined
          ? {}
          : { defaultSize: bottomPanelDefaultSizes.mainPanelDefaultSize })}
      >
        {mainWorkspace}
      </ResizablePanel>
      <ResizableHandle
        className={
          isBottomPanelVisible
            ? "relative -my-1 shrink-0 bg-transparent aria-orientation-horizontal:!h-3 aria-orientation-horizontal:cursor-row-resize after:absolute after:inset-x-0 after:top-1/2 after:-translate-y-1/2 after:bg-stone-300/90 hover:after:bg-stone-400/90 aria-orientation-horizontal:after:h-px"
            : "hidden"
        }
      />
      <ResizablePanel
        collapsedSize={0}
        collapsible
        defaultSize={bottomPanelDefaultSizes.bottomPanelDefaultSize}
        minSize={`${String(MIN_TERMINAL_PANEL_SIZE)}px`}
        onResize={(panelSize) => {
          if (panelSize.inPixels > 0) {
            onBottomPanelResize(panelSize.inPixels);
          }
        }}
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
          <Notice key={`${alert.title}:${alert.description}`} title={alert.title} variant="alert">
            {alert.description}
          </Notice>
        </div>
      )}

      {isSecondaryPanelVisible ? (
        <ResizablePanelGroup
          className="min-h-0 flex-1"
          key={sandboxInstanceId}
          orientation="horizontal"
        >
          <ResizablePanel defaultSize={`${String(100 - secondaryPanelSize)}%`} minSize="25%">
            {workspaceWithBottomPanel}
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel
            defaultSize={`${String(secondaryPanelSize)}%`}
            minSize="20%"
            onResize={(panelSize) => {
              onSecondaryPanelResize(panelSize.asPercentage);
            }}
          >
            <div className="bg-background/98 h-full min-h-0 overflow-hidden backdrop-blur-sm">
              <div className="h-full w-full">{secondaryPanel}</div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        workspaceWithBottomPanel
      )}
    </div>
  );
}

export { resolveBottomPanelDefaultSizes };

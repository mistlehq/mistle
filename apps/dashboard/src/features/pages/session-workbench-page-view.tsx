import { ResizableHandle, ResizablePanel, ResizablePanelGroup, Notice } from "@mistle/ui";

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
  alerts: readonly SessionWorkbenchAlert[];
  isPrimaryPanelTransitioning?: boolean;
  mainContentLayout?: SessionWorkbenchMainContentLayout;
  mainContent: React.ReactNode;
  primaryBottomPanel: React.ReactNode;
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

export function SessionWorkbenchPageView({
  sandboxInstanceId,
  alerts,
  isPrimaryPanelTransitioning = false,
  mainContentLayout = { scroll: "page", width: "chat" },
  mainContent,
  primaryBottomPanel,
  secondaryPanel,
  secondaryPanelSize,
  onSecondaryPanelResize,
  isSecondaryPanelVisible,
}: SessionWorkbenchPageViewProps): React.JSX.Element {
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {alerts.length === 0 ? null : (
        <div className="mx-auto flex w-full max-w-3xl flex-none flex-col gap-4 px-4 py-6">
          {alerts.map((alert) => (
            <Notice key={`${alert.title}:${alert.description}`} title={alert.title} variant="alert">
              {alert.description}
            </Notice>
          ))}
        </div>
      )}

      {isSecondaryPanelVisible ? (
        <ResizablePanelGroup
          className="min-h-0 flex-1"
          key={sandboxInstanceId}
          orientation="vertical"
        >
          <ResizablePanel defaultSize={100 - secondaryPanelSize} minSize={25}>
            <div
              className={`flex h-full min-h-0 flex-col overflow-hidden ${primaryPanelTransitionClassName}`}
            >
              <div
                aria-label="Conversation chat"
                className={mainContentRegionClassName}
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
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel
            defaultSize={secondaryPanelSize}
            minSize={20}
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
        <>
          <div
            aria-label="Conversation chat"
            className={`${mainContentRegionClassName} ${primaryPanelTransitionClassName}`}
            role="region"
            style={mainContentScrollbarGutterStyle}
          >
            <div className={mainContentContainerClassName}>{mainContent}</div>
          </div>

          {!hasPrimaryBottomPanel ? null : (
            <div
              className={`bg-background/95 flex-none pt-3 pb-4 backdrop-blur-sm ${primaryPanelTransitionClassName}`}
            >
              <div className="mx-auto w-full max-w-3xl px-4">{primaryBottomPanel}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

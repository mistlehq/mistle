import {
  Alert,
  AlertDescription,
  AlertTitle,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@mistle/ui";

type SessionWorkbenchAlert = {
  title: string;
  description: string;
};

type SessionWorkbenchPageViewProps = {
  sandboxInstanceId: string | null;
  alerts: readonly SessionWorkbenchAlert[];
  mainContent: React.ReactNode;
  primaryBottomPanel: React.ReactNode;
  secondaryPanel: React.ReactNode;
  secondaryPanelSize: number;
  onSecondaryPanelResize: (size: number) => void;
  isSecondaryPanelVisible: boolean;
};

export type { SessionWorkbenchAlert, SessionWorkbenchPageViewProps };

export function SessionWorkbenchPageView({
  sandboxInstanceId,
  alerts,
  mainContent,
  primaryBottomPanel,
  secondaryPanel,
  secondaryPanelSize,
  onSecondaryPanelResize,
  isSecondaryPanelVisible,
}: SessionWorkbenchPageViewProps): React.JSX.Element {
  if (sandboxInstanceId === null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Session id is missing</AlertTitle>
        <AlertDescription>Open a session from the Sessions page.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {alerts.length === 0 ? null : (
        <div className="mx-auto flex w-full max-w-3xl flex-none flex-col gap-4 px-4 py-6">
          {alerts.map((alert) => (
            <Alert key={`${alert.title}:${alert.description}`} variant="destructive">
              <AlertTitle>{alert.title}</AlertTitle>
              <AlertDescription>{alert.description}</AlertDescription>
            </Alert>
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
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <div
                aria-label="Conversation chat"
                className="min-h-0 flex-1 overflow-y-auto"
                role="region"
                style={{ scrollbarGutter: "stable both-edges" }}
              >
                <div className="mx-auto w-full max-w-3xl px-4 pb-4">{mainContent}</div>
              </div>

              <div className="bg-background/95 flex-none pt-3 pb-4 backdrop-blur-sm">
                <div className="mx-auto w-full max-w-3xl px-4">{primaryBottomPanel}</div>
              </div>
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
            className="min-h-0 flex-1 overflow-y-auto"
            role="region"
            style={{ scrollbarGutter: "stable both-edges" }}
          >
            <div className="mx-auto w-full max-w-3xl px-4 pb-4">{mainContent}</div>
          </div>

          <div className="bg-background/95 flex-none pt-3 pb-4 backdrop-blur-sm">
            <div className="mx-auto w-full max-w-3xl px-4">{primaryBottomPanel}</div>
          </div>
        </>
      )}
    </div>
  );
}

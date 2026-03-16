import { Alert, AlertDescription, AlertTitle } from "@mistle/ui";

type SessionWorkbenchAlert = {
  title: string;
  description: string;
};

type SessionWorkbenchPageViewProps = {
  sandboxInstanceId: string | null;
  alerts: readonly SessionWorkbenchAlert[];
  mainContent: React.ReactNode;
  bottomPanel: React.ReactNode;
};

export type { SessionWorkbenchAlert, SessionWorkbenchPageViewProps };

export function SessionWorkbenchPageView({
  sandboxInstanceId,
  alerts,
  mainContent,
  bottomPanel,
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

      <div
        aria-label="Conversation chat"
        className="min-h-0 flex-1 overflow-y-auto"
        role="region"
        style={{ scrollbarGutter: "stable both-edges" }}
      >
        <div className="mx-auto w-full max-w-3xl px-4 pb-4">{mainContent}</div>
      </div>

      <div className="bg-background/95 flex-none pt-3 pb-4 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-3xl px-4">{bottomPanel}</div>
      </div>
    </div>
  );
}

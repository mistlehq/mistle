type SessionPtyPanelShellProps = {
  body: React.ReactNode;
  dataPtyState?: string;
  header?: React.ReactNode;
  message?: React.ReactNode;
  showTopBorder?: boolean;
};

export function SessionPtyPanelShell({
  body,
  dataPtyState,
  header,
  message,
  showTopBorder = true,
}: SessionPtyPanelShellProps): React.JSX.Element {
  return (
    <div className="h-full min-h-0 bg-background">
      <div
        className={`flex h-full min-h-0 flex-col overflow-hidden bg-background${showTopBorder ? " border-t" : ""}`}
        data-pty-state={dataPtyState}
      >
        {header === undefined ? null : (
          <div className="flex items-center gap-2 bg-background px-3 py-1">{header}</div>
        )}
        {message === undefined ? null : (
          <div className="border-b bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            {message}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      </div>
    </div>
  );
}

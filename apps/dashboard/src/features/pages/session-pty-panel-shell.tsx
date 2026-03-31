const SESSION_PTY_PANEL_BORDER_COLOR = "#D6D3D1";

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
    <div className="h-full min-h-0 bg-white">
      <div
        className={`flex h-full min-h-0 flex-col overflow-hidden bg-white${showTopBorder ? " border-t" : ""}`}
        data-pty-state={dataPtyState}
        style={{ borderColor: SESSION_PTY_PANEL_BORDER_COLOR }}
      >
        {header === undefined ? null : (
          <div className="flex items-center gap-2 bg-white px-3 py-1">{header}</div>
        )}
        {message === undefined ? null : (
          <div className="border-b border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
            {message}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      </div>
    </div>
  );
}

type SessionPtyPanelHeaderProps = {
  actions?: React.ReactNode;
  title: string;
};

export function SessionPtyPanelHeader({
  actions,
  title,
}: SessionPtyPanelHeaderProps): React.JSX.Element {
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div aria-hidden className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-sm font-semibold text-stone-900">{title}</span>
        </div>
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      )}
    </>
  );
}

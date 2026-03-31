import { cn } from "@mistle/ui";

type SessionPtyPanelHeaderProps = {
  actions?: React.ReactNode;
  indicatorTitle: string;
  isActive: boolean;
  title: string;
};

export function SessionPtyPanelHeader({
  actions,
  indicatorTitle,
  isActive,
  title,
}: SessionPtyPanelHeaderProps): React.JSX.Element {
  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div aria-hidden className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-sm font-semibold text-stone-900">{title}</span>
          <span className="flex items-center gap-2" title={indicatorTitle}>
            <span
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                isActive ? "bg-emerald-500" : "bg-stone-400",
              )}
            />
          </span>
        </div>
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      )}
    </>
  );
}

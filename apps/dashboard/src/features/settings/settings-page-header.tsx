export type SettingsPageHeaderProps = {
  headerActions: React.ReactNode | null;
  headerIcon?: React.ReactNode | null;
  supportingText: string;
  title: string;
};

export function SettingsPageHeader(input: SettingsPageHeaderProps): React.JSX.Element {
  const shouldShowSupportingText = input.supportingText.trim().length > 0;
  const shouldUseHeaderIcon = input.headerIcon !== undefined && input.headerIcon !== null;
  const textStackClassName = shouldUseHeaderIcon ? "gap-0" : "gap-1";
  const titleClassName = shouldUseHeaderIcon
    ? "truncate text-xl font-semibold leading-tight"
    : "truncate text-xl font-semibold";
  const supportingTextClassName = shouldUseHeaderIcon
    ? "text-muted-foreground text-sm leading-tight"
    : "text-muted-foreground text-sm";

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {shouldUseHeaderIcon ? <div className="shrink-0">{input.headerIcon}</div> : null}
        <div className={`min-w-0 flex flex-col ${textStackClassName}`}>
          <h1 className={titleClassName}>{input.title}</h1>
          {shouldShowSupportingText ? (
            <p className={supportingTextClassName}>{input.supportingText}</p>
          ) : null}
        </div>
      </div>
      {input.headerActions ? <div className="shrink-0">{input.headerActions}</div> : null}
    </div>
  );
}

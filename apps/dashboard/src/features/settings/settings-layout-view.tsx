export type SettingsLayoutViewProps = {
  children: React.ReactNode;
  description: string;
  headerActions: React.ReactNode | null;
  title: string;
};

export function SettingsLayoutView(input: SettingsLayoutViewProps): React.JSX.Element {
  const shouldShowDescription = input.description.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{input.title}</h1>
          {shouldShowDescription ? (
            <p className="text-muted-foreground text-sm">{input.description}</p>
          ) : null}
        </div>
        {input.headerActions ? <div className="shrink-0">{input.headerActions}</div> : null}
      </div>
      {input.children}
    </div>
  );
}

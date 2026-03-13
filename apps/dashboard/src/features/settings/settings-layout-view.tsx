import { SettingsPageHeader } from "./settings-page-header.js";

export type SettingsLayoutViewProps = {
  children: React.ReactNode;
  supportingText: string;
  headerActions: React.ReactNode | null;
  headerIcon?: React.ReactNode | null;
  title: string;
};

export function SettingsLayoutView(input: SettingsLayoutViewProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <SettingsPageHeader
        headerActions={input.headerActions}
        headerIcon={input.headerIcon}
        supportingText={input.supportingText}
        title={input.title}
      />
      {input.children}
    </div>
  );
}

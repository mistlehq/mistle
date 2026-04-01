import { SettingsPageHeader } from "./settings-page-header.js";

export type SettingsLayoutViewProps = {
  children: React.ReactNode;
  supportingText: string;
  headerActions: React.ReactNode | null;
  headerIcon?: React.ReactNode | null;
  layoutVariant?: "default" | "form";
  title: string;
};

export function SettingsLayoutView(input: SettingsLayoutViewProps): React.JSX.Element {
  const isFormLayout = input.layoutVariant === "form";

  if (isFormLayout) {
    return <>{input.children}</>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <SettingsPageHeader
          headerActions={input.headerActions}
          headerIcon={input.headerIcon}
          supportingText={input.supportingText}
          title={input.title}
        />
      </div>
      {input.children}
    </div>
  );
}

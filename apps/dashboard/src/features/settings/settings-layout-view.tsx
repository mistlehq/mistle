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

  return (
    <div className={isFormLayout ? "flex flex-col gap-3" : "flex flex-col gap-4"}>
      <div className={isFormLayout ? "mx-auto w-full max-w-2xl" : undefined}>
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

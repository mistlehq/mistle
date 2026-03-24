import { FormPageHeader } from "../shared/form-page.js";

export type SettingsPageHeaderProps = {
  headerActions: React.ReactNode | null;
  headerIcon?: React.ReactNode | null;
  supportingText: string;
  title: string;
};

export function SettingsPageHeader(input: SettingsPageHeaderProps): React.JSX.Element {
  return (
    <FormPageHeader
      actions={input.headerActions}
      description={input.supportingText.trim().length > 0 ? input.supportingText : undefined}
      icon={input.headerIcon}
      title={input.title}
    />
  );
}

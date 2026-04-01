import { ErrorNotice } from "../auth/error-notice.js";
import { AppShellView } from "../shell/app-shell-view.js";
import { SettingsBackButton } from "./settings-back-button.js";
import { SettingsLayoutView } from "./settings-layout-view.js";
import { SettingsSectionNavView } from "./settings-section-nav-view.js";

export type SettingsShellViewProps = {
  backLabel?: string;
  breadcrumbs: React.ReactNode | null;
  content: React.ReactNode;
  supportingText: string;
  headerActions: React.ReactNode | null;
  layoutVariant?: "default" | "form";
  onBack: () => void;
  pathname: string;
  showBreadcrumbs: boolean;
  title: string;
};

export function SettingsShellView(input: SettingsShellViewProps): React.JSX.Element {
  const isFormLayout = input.layoutVariant === "form";

  return (
    <AppShellView
      breadcrumbs={input.breadcrumbs}
      headerActions={null}
      isSessionDetail={false}
      mainContent={
        isFormLayout ? (
          input.content
        ) : (
          <SettingsLayoutView
            supportingText={input.supportingText}
            headerActions={input.headerActions}
            headerIcon={null}
            title={input.title}
          >
            {input.content}
          </SettingsLayoutView>
        )
      }
      showBreadcrumbs={input.showBreadcrumbs}
      sidebarContent={<SettingsSectionNavView pathname={input.pathname} />}
      sidebarFooterContent={<ErrorNotice message={null} />}
      sidebarHeaderClassName="pb-0"
      sidebarHeaderContent={<SettingsBackButton onBack={input.onBack} />}
      topLoadingBar={<div className="h-0" />}
    />
  );
}

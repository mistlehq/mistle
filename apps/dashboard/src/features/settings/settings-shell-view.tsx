import { ErrorNotice } from "../auth/error-notice.js";
import { AppShellView } from "../shell/app-shell-view.js";
import { SettingsBackButton } from "./settings-back-button.js";
import { SettingsLayoutView } from "./settings-layout-view.js";
import { SettingsSectionNavView } from "./settings-section-nav-view.js";

export type SettingsShellViewProps = {
  backLabel?: string;
  breadcrumbs: React.ReactNode | null;
  content: React.ReactNode;
  description: string;
  headerActions: React.ReactNode | null;
  onBack: () => void;
  pathname: string;
  showBreadcrumbs: boolean;
  title: string;
};

export function SettingsShellView(input: SettingsShellViewProps): React.JSX.Element {
  return (
    <AppShellView
      breadcrumbs={input.breadcrumbs}
      headerActions={null}
      isSessionDetail={false}
      mainContent={
        <SettingsLayoutView
          description={input.description}
          headerActions={input.headerActions}
          title={input.title}
        >
          {input.content}
        </SettingsLayoutView>
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

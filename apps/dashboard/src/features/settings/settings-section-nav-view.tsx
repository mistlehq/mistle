import { SidebarNavGroups } from "../navigation/sidebar-nav-groups.js";
import { SETTINGS_NAV_GROUPS } from "./model.js";

export type SettingsSectionNavViewProps = {
  pathname: string;
};

export function SettingsSectionNavView(input: SettingsSectionNavViewProps): React.JSX.Element {
  return (
    <SidebarNavGroups
      groupClassName={(index) => (index === 0 ? "pt-4" : "pt-0")}
      groupContentClassName="mt-1.5"
      groups={SETTINGS_NAV_GROUPS}
      pathname={input.pathname}
    />
  );
}

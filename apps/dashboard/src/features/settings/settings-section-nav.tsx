import { useLocation } from "react-router";

import { SidebarNavGroups } from "../navigation/sidebar-nav-groups.js";
import { SETTINGS_NAV_GROUPS } from "./model.js";

export function SettingsSectionNav(): React.JSX.Element {
  const location = useLocation();

  return (
    <SidebarNavGroups
      groupClassName={(index) => (index === 0 ? "pt-4" : "pt-0")}
      groupContentClassName="mt-1.5"
      groups={SETTINGS_NAV_GROUPS}
      pathname={location.pathname}
    />
  );
}

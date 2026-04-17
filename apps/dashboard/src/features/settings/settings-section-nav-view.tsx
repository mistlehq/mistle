import { SidebarNavGroups } from "../navigation/sidebar-nav-groups.js";
import type { SidebarNavGroup } from "../navigation/sidebar-nav-model.js";

export type SettingsSectionNavViewProps = {
  groups: readonly SidebarNavGroup[];
  pathname: string;
};

export function SettingsSectionNavView(input: SettingsSectionNavViewProps): React.JSX.Element {
  return (
    <SidebarNavGroups
      groupClassName={(index) => (index === 0 ? "pt-4" : "pt-0")}
      groupContentClassName="mt-1.5"
      groups={input.groups}
      pathname={input.pathname}
    />
  );
}

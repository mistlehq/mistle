import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@mistle/ui";
import { NavLink } from "react-router";

import { isSidebarNavItemActive, type SidebarNavGroup } from "./sidebar-nav-model.js";

const DEFAULT_GROUP_LABEL_CLASS =
  "pointer-events-none h-auto rounded-none px-2 py-0 text-xs font-medium tracking-wide uppercase text-muted-foreground";

export function SidebarNavGroups(input: {
  groups: readonly SidebarNavGroup[];
  pathname: string;
  groupClassName?: (index: number) => string | undefined;
  groupLabelClassName?: string;
  groupContentClassName?: string;
  showGroupLabel?: boolean | ((group: SidebarNavGroup, index: number) => boolean);
}): React.JSX.Element {
  const groupLabelClassName = input.groupLabelClassName ?? DEFAULT_GROUP_LABEL_CLASS;

  return (
    <>
      {input.groups.map((group, index) => (
        <SidebarGroup
          className={input.groupClassName?.(index)}
          key={group.label ?? `group-${index}`}
        >
          {typeof input.showGroupLabel === "function" ? (
            input.showGroupLabel(group, index)
          ) : (input.showGroupLabel ?? true) && typeof group.label === "string" ? (
            <SidebarGroupLabel className={groupLabelClassName}>{group.label}</SidebarGroupLabel>
          ) : null}
          <SidebarGroupContent className={input.groupContentClassName}>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    isActive={isSidebarNavItemActive(input.pathname, item)}
                    render={<NavLink to={item.to} />}
                  >
                    {item.icon ? <item.icon aria-hidden className="size-4 shrink-0" /> : null}
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

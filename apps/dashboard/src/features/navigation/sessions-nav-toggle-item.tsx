import { SidebarMenuButton, SidebarMenuItem } from "@mistle/ui";
import { TerminalIcon } from "@phosphor-icons/react";
import { NavLink, useLocation } from "react-router";

import {
  resolveSessionsNavHref,
  isSessionsPath,
} from "../shell/app-shell-sessions-sidebar-mode.js";
import { SessionsSidebarModeSwitch } from "./sessions-sidebar-mode-switch.js";

export function SessionsNavToggleItem(input: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}): React.JSX.Element {
  const location = useLocation();
  const sessionsHref = resolveSessionsNavHref(input.checked);
  const isActive = isSessionsPath(location.pathname);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className="pr-14 md:pr-12"
        isActive={isActive}
        render={<NavLink to={sessionsHref} />}
      >
        <TerminalIcon aria-hidden className="size-5 shrink-0 md:size-4" />
        <span>Sessions</span>
      </SidebarMenuButton>
      <div className="absolute top-1/2 right-3 -translate-y-1/2 md:right-2">
        <SessionsSidebarModeSwitch
          checked={input.checked}
          onCheckedChange={input.onCheckedChange}
          preventSidebarItemNavigation
        />
      </div>
    </SidebarMenuItem>
  );
}

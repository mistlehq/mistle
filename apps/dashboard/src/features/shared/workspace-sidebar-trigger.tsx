import { SidebarTrigger, useSidebar } from "@mistle/ui";

import { shouldRenderSidebarTrigger } from "./sidebar-trigger-visibility.js";

export function WorkspaceSidebarTrigger(): React.JSX.Element | null {
  const { isMobile, openMobile, state } = useSidebar();
  const shouldShowSidebarTrigger = shouldRenderSidebarTrigger({
    isMobile,
    openMobile,
    sidebarState: state,
  });

  return shouldShowSidebarTrigger ? <SidebarTrigger className="-ml-1" /> : null;
}

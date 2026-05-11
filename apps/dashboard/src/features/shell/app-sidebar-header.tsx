import { Button, useSidebar } from "@mistle/ui";
import { CaretDoubleLeftIcon } from "@phosphor-icons/react";
import type { ComponentProps } from "react";

import { OrganizationMenuTrigger } from "./organization-menu-trigger.js";

type AppSidebarHeaderProps = ComponentProps<typeof OrganizationMenuTrigger>;

export function AppSidebarHeader(input: AppSidebarHeaderProps): React.JSX.Element {
  const { isMobile, openMobile, state, toggleSidebar } = useSidebar();
  const showCollapseControl = isMobile ? openMobile : state === "expanded";

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="min-w-0 flex-1">
        <OrganizationMenuTrigger {...input} />
      </div>
      {showCollapseControl ? (
        <Button
          aria-label="Collapse sidebar"
          className="shrink-0"
          onClick={toggleSidebar}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <CaretDoubleLeftIcon aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

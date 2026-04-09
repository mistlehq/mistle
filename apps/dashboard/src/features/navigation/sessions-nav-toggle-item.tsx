import { SidebarMenuButton, SidebarMenuItem, Switch } from "@mistle/ui";
import { TerminalIcon } from "@phosphor-icons/react";
import { NavLink } from "react-router";

export function SessionsNavToggleItem(input: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}): React.JSX.Element {
  const sessionsHref = input.checked ? "/sessions/new" : "/sessions";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton className="pr-12" render={<NavLink to={sessionsHref} />}>
        <TerminalIcon aria-hidden className="size-4 shrink-0" />
        <span>Sessions</span>
      </SidebarMenuButton>
      <div className="absolute top-1/2 right-2 -translate-y-1/2">
        <Switch
          aria-label="Toggle sessions sidebar view"
          checked={input.checked}
          onCheckedChange={input.onCheckedChange}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className="cursor-default"
          size="sm"
        />
      </div>
    </SidebarMenuItem>
  );
}

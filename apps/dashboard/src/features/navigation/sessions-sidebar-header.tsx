import { SidebarTrigger } from "@mistle/ui";

import { SessionsSidebarModeSwitch } from "./sessions-sidebar-mode-switch.js";

export function SessionsSidebarHeader(input: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <div className="flex min-w-0 items-center">
        <span className="truncate font-bold text-xs uppercase tracking-[0.18em] text-foreground/90">
          Sessions
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SessionsSidebarModeSwitch
          checked={input.checked}
          onCheckedChange={input.onCheckedChange}
        />
        {input.checked ? <SidebarTrigger className="size-7 cursor-default" /> : null}
      </div>
    </div>
  );
}

import { SidebarTrigger, Switch } from "@mistle/ui";

export function SessionsSidebarModeControl(input: {
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
        <Switch
          aria-label="Toggle sessions sidebar view"
          checked={input.checked}
          onCheckedChange={input.onCheckedChange}
          className="cursor-default"
          size="sm"
        />
        {input.checked ? <SidebarTrigger className="size-7 cursor-default" /> : null}
      </div>
    </div>
  );
}

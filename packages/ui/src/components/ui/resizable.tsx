import * as React from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "../../lib/utils.js";

function ResizablePanelGroup({ className, ...props }: React.ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full", className)}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: React.ComponentProps<typeof Panel>) {
  return <Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean;
}) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "bg-border focus-visible:ring-ring relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden aria-orientation-horizontal:h-px aria-orientation-horizontal:w-full aria-orientation-horizontal:after:top-1/2 aria-orientation-horizontal:after:left-0 aria-orientation-horizontal:after:h-1 aria-orientation-horizontal:after:w-full aria-orientation-horizontal:after:-translate-y-1/2 aria-orientation-horizontal:after:translate-x-0",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-border h-6 w-1 rounded-lg z-10 flex shrink-0 aria-orientation-horizontal:h-1 aria-orientation-horizontal:w-12" />
      )}
    </Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };

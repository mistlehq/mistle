import * as React from "react";

import { cn } from "../../lib/utils.js";

type DetailLabelProps = React.HTMLAttributes<HTMLElement> & {
  as?: "dt" | "p" | "div" | "span";
};

function DetailLabel({ as: Component = "dt", className, ...props }: DetailLabelProps) {
  return (
    <Component
      className={cn("text-muted-foreground text-xs uppercase tracking-wide", className)}
      data-slot="detail-label"
      {...props}
    />
  );
}

export { DetailLabel };
export type { DetailLabelProps };

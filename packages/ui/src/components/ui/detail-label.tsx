import * as React from "react";

import { cn } from "../../lib/utils.js";

export const detailLabelTextClassName = "text-muted-foreground text-xs uppercase tracking-wide";

type DetailLabelProps = React.HTMLAttributes<HTMLElement> & {
  as?: "dt" | "p" | "div" | "span";
};

function DetailLabel({ as: Component = "dt", className, ...props }: DetailLabelProps) {
  return (
    <Component
      className={cn(detailLabelTextClassName, className)}
      data-slot="detail-label"
      {...props}
    />
  );
}

export { DetailLabel };
export type { DetailLabelProps };

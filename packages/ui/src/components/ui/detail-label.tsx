import { InfoIcon } from "@phosphor-icons/react";
import * as React from "react";

import { cn } from "../../lib/utils.js";
import { detailLabelTextClassName } from "./label-text.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

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

type DetailLabelWithTooltipProps = DetailLabelProps & {
  tooltip: React.ReactNode;
  tooltipContentClassName?: string;
  tooltipLabel: string;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
};

function DetailLabelWithTooltip({
  children,
  tooltip,
  tooltipContentClassName,
  tooltipLabel,
  tooltipSide = "top",
  ...props
}: DetailLabelWithTooltipProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <DetailLabel {...props}>{children}</DetailLabel>
      <Tooltip delay={0}>
        <TooltipTrigger
          aria-label={tooltipLabel}
          render={
            <button
              className="text-foreground/80 hover:text-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-sm"
              type="button"
            />
          }
        >
          <InfoIcon aria-hidden className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent
          className={cn("max-w-64 text-left", tooltipContentClassName)}
          side={tooltipSide}
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export { DetailLabel, DetailLabelWithTooltip };
export type { DetailLabelProps, DetailLabelWithTooltipProps };

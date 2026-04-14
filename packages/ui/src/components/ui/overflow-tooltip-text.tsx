import { useEffect, useState } from "react";

import { cn } from "../../lib/utils.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

type OverflowTooltipTextProps = {
  ariaLabel?: string;
  text: string;
  className?: string;
  containerClassName?: string;
  tooltipClassName?: string;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>["side"];
  tooltipVariant?: React.ComponentProps<typeof TooltipContent>["variant"];
  tooltipShowArrow?: boolean;
};

function OverflowTooltipText({
  ariaLabel,
  text,
  className,
  containerClassName,
  tooltipClassName,
  tooltipSide = "top",
  tooltipVariant = "light",
  tooltipShowArrow = false,
}: OverflowTooltipTextProps): React.JSX.Element {
  const [textElement, setTextElement] = useState<HTMLSpanElement | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    if (textElement === null) {
      setIsTruncated(false);
      return;
    }

    const updateTruncation = () => {
      setIsTruncated(textElement.scrollWidth > textElement.clientWidth);
    };

    updateTruncation();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(updateTruncation);
    resizeObserver.observe(textElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [text, textElement]);

  return (
    <Tooltip delay={0} disabled={!isTruncated}>
      <TooltipTrigger
        render={
          <span
            aria-label={ariaLabel}
            className={cn("block min-w-0 max-w-full", containerClassName)}
          >
            <span className={cn("block truncate", className)} ref={setTextElement}>
              {text}
            </span>
          </span>
        }
      />
      <TooltipContent
        className={cn("max-w-80 whitespace-pre-wrap text-left", tooltipClassName)}
        showArrow={tooltipShowArrow}
        side={tooltipSide}
        variant={tooltipVariant}
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export { OverflowTooltipText };

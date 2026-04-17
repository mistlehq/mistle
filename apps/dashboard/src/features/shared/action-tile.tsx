import { cn } from "@mistle/ui";
import type { ReactNode } from "react";

type ActionTileProps = {
  action?: ReactNode;
  actionContainerClassName?: string;
  badge?: ReactNode;
  className?: string;
  contentClassName?: string;
  description: ReactNode;
  descriptionClassName?: string;
  leading?: ReactNode;
  leadingPlacement?: "detached" | "inline";
  padding?: "comfortable" | "default";
  title: ReactNode;
  titleClassName?: string;
};

export function ActionTile({
  action,
  actionContainerClassName,
  badge,
  className,
  contentClassName,
  description,
  descriptionClassName,
  leading,
  leadingPlacement = "inline",
  padding = "default",
  title,
  titleClassName,
}: ActionTileProps): React.JSX.Element {
  const isDetachedLeading = leading !== undefined && leadingPlacement === "detached";
  const hasAction = action != null;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border py-3 sm:flex-row sm:items-center sm:justify-between",
        padding === "default" && "px-3",
        padding === "comfortable" && "px-4",
        className,
      )}
    >
      <div className={cn("min-w-0", contentClassName)}>
        <div
          className={cn(
            "flex items-start gap-1",
            isDetachedLeading ? "" : "min-w-0 flex-col gap-1",
          )}
        >
          {leading === undefined ? null : isDetachedLeading ? (
            <div className="hidden h-5 w-4 shrink-0 items-center justify-start sm:flex">
              {leading}
            </div>
          ) : null}
          <div
            className={cn(
              "min-w-0 space-y-1",
              isDetachedLeading ? "" : "flex flex-col gap-1 space-y-0",
            )}
          >
            <div className="flex items-center gap-1 sm:gap-2">
              {leading === undefined ? null : isDetachedLeading ? (
                <div className="flex h-5 w-5 shrink-0 items-center justify-center sm:hidden">
                  {leading}
                </div>
              ) : (
                <div className="flex h-5 w-5 shrink-0 items-center justify-center">{leading}</div>
              )}
              <p className={cn("text-sm font-medium", titleClassName)}>{title}</p>
              {badge}
            </div>
            <p className={cn("text-muted-foreground text-sm", descriptionClassName)}>
              {description}
            </p>
          </div>
        </div>
      </div>
      {hasAction ? (
        <div
          className={cn("flex items-center justify-end sm:justify-start", actionContainerClassName)}
        >
          {action}
        </div>
      ) : null}
    </div>
  );
}

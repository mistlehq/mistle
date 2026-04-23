import { cn } from "@mistle/ui";
import type { ReactNode } from "react";

const ActionTileStyles = {
  default: {
    description: "text-muted-foreground",
    root: "",
    title: "",
  },
  info: {
    description: "text-blue-500",
    root: "border-blue-200 bg-blue-50",
    title: "text-blue-600",
  },
} as const;

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
  variant?: "default" | "info";
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
  variant = "default",
}: ActionTileProps): React.JSX.Element {
  const isDetachedLeading = leading !== undefined && leadingPlacement === "detached";
  const hasAction = action != null;
  const styles = ActionTileStyles[variant];

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border py-3 sm:flex-row sm:items-center sm:justify-between",
        styles.root,
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
              <p className={cn("text-sm font-medium", styles.title, titleClassName)}>{title}</p>
              {badge}
            </div>
            <p className={cn("text-sm", styles.description, descriptionClassName)}>{description}</p>
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

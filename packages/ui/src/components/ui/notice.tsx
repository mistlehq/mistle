import { systemScheduler, type Scheduler } from "@mistle/time";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../lib/utils.js";
import { Button } from "./button.js";

const noticeVariants = cva(
  [
    "group/notice w-full rounded-lg text-left text-sm whitespace-normal [overflow-wrap:anywhere]",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "",
        success:
          "[&_[data-slot=notice-description]]:text-emerald-700 [&_[data-slot=notice-icon]]:text-current text-emerald-700",
        warning:
          "[&_[data-slot=notice-description]]:text-amber-950/90 [&_[data-slot=notice-icon]]:text-current text-amber-950",
        alert:
          "[&_[data-slot=notice-description]]:text-destructive/90 [&_[data-slot=notice-icon]]:text-current text-destructive",
      },
      appearance: {
        boxed: "border px-4 py-3",
        subtle: "border border-transparent px-3 py-2",
      },
    },
    compoundVariants: [
      {
        variant: "default",
        appearance: "boxed",
        className: "bg-muted/20 text-muted-foreground",
      },
      {
        variant: "default",
        appearance: "subtle",
        className: "bg-muted/20 text-muted-foreground",
      },
      {
        variant: "success",
        appearance: "boxed",
        className: "bg-emerald-600/10 border-emerald-600/30",
      },
      {
        variant: "success",
        appearance: "subtle",
        className: "bg-emerald-600/10",
      },
      {
        variant: "warning",
        appearance: "boxed",
        className: "bg-amber-50 border-amber-300/70",
      },
      {
        variant: "warning",
        appearance: "subtle",
        className: "bg-amber-50/80",
      },
      {
        variant: "alert",
        appearance: "boxed",
        className: "bg-destructive/5 border-destructive/40",
      },
      {
        variant: "alert",
        appearance: "subtle",
        className: "bg-destructive/5",
      },
    ],
    defaultVariants: {
      variant: "default",
      appearance: "boxed",
    },
  },
);

const NoticeDefaultLifecycleKey = Symbol("Notice default lifecycle key");

type NoticeLifecycleKey = React.Key | typeof NoticeDefaultLifecycleKey;

const NoticeAutoHideDurationsMs = Object.freeze({
  MEDIUM: 5000,
  LONG: 8000,
});
const NoticeDismissAnimationMs = 200;

type NoticeOwnProps = {
  action?: React.ReactNode;
  autoHideAfterMs?: number | undefined;
  dismissible?: boolean;
  icon?: React.ReactNode;
  onDismiss?: () => void;
  /**
   * Identifies the current logical notice message for dismiss/auto-hide lifecycle.
   * Change this value when reusing the same Notice instance for a new message.
   */
  resetKey?: React.Key | undefined;
  scheduler?: Scheduler | undefined;
  title?: React.ReactNode;
};

function hasVisibleContent(value: React.ReactNode): boolean {
  return value !== undefined && value !== null && value !== "";
}

function resolveLayoutState(input: {
  action?: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  title?: React.ReactNode;
}) {
  const hasAction = hasVisibleContent(input.action);
  const hasDescription = hasVisibleContent(input.children);
  const hasIcon = hasVisibleContent(input.icon);
  const hasTitle = hasVisibleContent(input.title);

  return {
    hasAction,
    hasDescription,
    hasIcon,
    hasTitle,
  };
}

type NoticeProps = Omit<React.ComponentProps<"div">, keyof NoticeOwnProps> &
  NoticeOwnProps &
  VariantProps<typeof noticeVariants>;

function resolveUrgencyProps(input: {
  ariaLive: React.AriaAttributes["aria-live"];
  role: React.AriaRole | undefined;
  variant: NoticeProps["variant"];
}): Pick<React.ComponentProps<"div">, "aria-live" | "role"> {
  if (input.role !== undefined || input.ariaLive !== undefined) {
    return {
      "aria-live": input.ariaLive,
      role: input.role,
    };
  }

  if (input.variant === "alert") {
    return {
      "aria-live": "assertive",
      role: "alert",
    };
  }

  return {
    "aria-live": undefined,
    role: undefined,
  };
}

function Notice({
  action,
  "aria-live": ariaLive,
  autoHideAfterMs,
  children,
  className,
  dismissible = false,
  icon,
  onDismiss,
  resetKey,
  role,
  scheduler = systemScheduler,
  title,
  variant,
  appearance,
  ...props
}: NoticeProps): React.JSX.Element | null {
  validateAutoHideAfterMs(autoHideAfterMs);

  const [, rerenderAfterDismissal] = React.useReducer(incrementDismissalCount, 0);
  const dismissedLifecycleKeyRef = React.useRef<NoticeLifecycleKey | null>(null);
  const [exitingLifecycleKey, setExitingLifecycleKey] = React.useState<NoticeLifecycleKey | null>(
    null,
  );
  const lifecycleKey = resetKey ?? NoticeDefaultLifecycleKey;
  const isDismissed = Object.is(dismissedLifecycleKeyRef.current, lifecycleKey);
  const isExiting = Object.is(exitingLifecycleKey, lifecycleKey);

  const dismissNotice = React.useCallback(() => {
    if (
      Object.is(dismissedLifecycleKeyRef.current, lifecycleKey) ||
      Object.is(exitingLifecycleKey, lifecycleKey)
    ) {
      return;
    }

    setExitingLifecycleKey(lifecycleKey);
    onDismiss?.();
  }, [exitingLifecycleKey, lifecycleKey, onDismiss]);

  React.useEffect(() => {
    if (autoHideAfterMs === undefined || isDismissed || isExiting) {
      return undefined;
    }

    const timeoutId = scheduler.schedule(dismissNotice, autoHideAfterMs);

    return () => {
      scheduler.cancel(timeoutId);
    };
  }, [autoHideAfterMs, dismissNotice, isDismissed, isExiting, lifecycleKey, scheduler]);

  React.useEffect(() => {
    if (!isExiting) {
      return undefined;
    }

    const timeoutId = scheduler.schedule(() => {
      dismissedLifecycleKeyRef.current = lifecycleKey;
      setExitingLifecycleKey(null);
      rerenderAfterDismissal();
    }, NoticeDismissAnimationMs);

    return () => {
      scheduler.cancel(timeoutId);
    };
  }, [isExiting, lifecycleKey, scheduler]);

  const layoutState = resolveLayoutState({
    action,
    children,
    icon,
    title,
  });
  const shouldRenderStructuredContent =
    dismissible || layoutState.hasIcon || layoutState.hasTitle || layoutState.hasAction;
  const urgencyProps = resolveUrgencyProps({
    ariaLive,
    role,
    variant,
  });

  if (isDismissed) {
    return null;
  }

  return (
    <div
      aria-live={urgencyProps["aria-live"]}
      className={cn(
        noticeVariants({ variant, appearance }),
        "grid grid-rows-[1fr] overflow-hidden transition-[opacity,grid-template-rows,padding,border-width] duration-200 ease-out data-[state=closing]:grid-rows-[0fr] data-[state=closing]:border-y-0 data-[state=closing]:py-0 data-[state=closing]:opacity-0",
        className,
      )}
      data-slot="notice"
      data-state={isExiting ? "closing" : "open"}
      role={urgencyProps.role}
      {...props}
    >
      <div className="min-h-0 overflow-hidden">
        {shouldRenderStructuredContent ? (
          <NoticeStructuredContent
            action={action}
            dismissButton={
              dismissible ? <NoticeDismissButton onClick={dismissNotice} /> : undefined
            }
            icon={icon}
            title={title}
          >
            {children}
          </NoticeStructuredContent>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function incrementDismissalCount(dismissalCount: number): number {
  return dismissalCount + 1;
}

function validateAutoHideAfterMs(autoHideAfterMs: number | undefined): void {
  if (
    autoHideAfterMs !== undefined &&
    (!Number.isFinite(autoHideAfterMs) || autoHideAfterMs <= 0)
  ) {
    throw new Error("Notice autoHideAfterMs must be a positive finite number.");
  }
}

function NoticeStructuredContent({
  action,
  children,
  dismissButton,
  icon,
  title,
}: {
  action?: React.ReactNode;
  children?: React.ReactNode;
  dismissButton?: React.ReactNode;
  icon?: React.ReactNode;
  title?: React.ReactNode;
}) {
  const layoutState = resolveLayoutState({
    action,
    children,
    icon,
    title,
  });
  const hasDismissButton = hasVisibleContent(dismissButton);
  const hasTrailingActions = layoutState.hasAction || hasDismissButton;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {!layoutState.hasTitle && !layoutState.hasDescription && !layoutState.hasIcon ? null : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5" data-slot="notice-main">
          {layoutState.hasIcon ? <NoticeIcon>{icon}</NoticeIcon> : null}
          {!layoutState.hasTitle && !layoutState.hasDescription ? null : (
            <div
              className="my-auto flex min-w-0 flex-1 flex-col gap-0.5"
              data-slot="notice-content"
            >
              {layoutState.hasTitle ? (
                layoutState.hasDescription ? (
                  <NoticeTitle>{title}</NoticeTitle>
                ) : (
                  <NoticeDescription>{title}</NoticeDescription>
                )
              ) : layoutState.hasDescription ? (
                <NoticeDescription>{children}</NoticeDescription>
              ) : null}
              {layoutState.hasDescription && layoutState.hasTitle ? (
                <NoticeDescription>{children}</NoticeDescription>
              ) : null}
            </div>
          )}
        </div>
      )}
      {hasTrailingActions ? (
        <NoticeAction>
          {layoutState.hasAction ? action : null}
          {hasDismissButton ? dismissButton : null}
        </NoticeAction>
      ) : null}
    </div>
  );
}

function NoticeIcon({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "my-auto shrink-0 text-current [&_svg:not([class*='size-'])]:size-4 [&_svg]:block",
        className,
      )}
      data-slot="notice-icon"
      {...props}
    />
  );
}

function NoticeTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "font-medium [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3",
        className,
      )}
      data-slot="notice-title"
      {...props}
    />
  );
}

function NoticeDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "min-w-0 text-sm whitespace-normal [overflow-wrap:anywhere] [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
        className,
      )}
      data-slot="notice-description"
      {...props}
    />
  );
}

function NoticeAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap justify-end gap-2 self-end sm:my-auto sm:ml-auto sm:shrink-0 sm:self-auto",
        className,
      )}
      data-slot="notice-action"
      {...props}
    />
  );
}

function NoticeDismissButton({ onClick }: { onClick: React.MouseEventHandler<HTMLButtonElement> }) {
  return (
    <Button
      className="border-current/25 bg-transparent text-current opacity-80 hover:border-current/35 hover:bg-current/10 hover:text-current hover:opacity-100"
      size="sm"
      type="button"
      variant="outline"
      onClick={onClick}
    >
      Dismiss
    </Button>
  );
}

export {
  Notice,
  NoticeAction,
  NoticeAutoHideDurationsMs,
  NoticeDismissAnimationMs,
  NoticeDescription,
  NoticeIcon,
  NoticeTitle,
};
export type { NoticeProps };

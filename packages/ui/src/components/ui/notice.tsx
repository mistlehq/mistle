import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../lib/utils.js";

const noticeVariants = cva(["group/notice w-full rounded-lg text-left text-sm"].join(" "), {
  variants: {
    variant: {
      default: "",
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
});

type NoticeOwnProps = {
  action?: React.ReactNode;
  icon?: React.ReactNode;
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

type NoticeProps = React.ComponentProps<"div"> &
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
  children,
  className,
  icon,
  role,
  title,
  variant,
  appearance,
  ...props
}: NoticeProps) {
  const layoutState = resolveLayoutState({
    action,
    children,
    icon,
    title,
  });
  const shouldRenderStructuredContent =
    layoutState.hasIcon || layoutState.hasTitle || layoutState.hasAction;
  const urgencyProps = resolveUrgencyProps({
    ariaLive,
    role,
    variant,
  });

  return (
    <div
      aria-live={urgencyProps["aria-live"]}
      className={cn(noticeVariants({ variant, appearance }), className)}
      data-slot="notice"
      role={urgencyProps.role}
      {...props}
    >
      {shouldRenderStructuredContent ? (
        <NoticeStructuredContent action={action} icon={icon} title={title}>
          {children}
        </NoticeStructuredContent>
      ) : (
        children
      )}
    </div>
  );
}

function NoticeStructuredContent({
  action,
  children,
  icon,
  title,
}: NoticeOwnProps & { children?: React.ReactNode }) {
  const layoutState = resolveLayoutState({
    action,
    children,
    icon,
    title,
  });

  return (
    <div className="flex items-center gap-3">
      {!layoutState.hasTitle && !layoutState.hasDescription && !layoutState.hasIcon ? null : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5" data-slot="notice-main">
          {layoutState.hasIcon ? <NoticeIcon>{icon}</NoticeIcon> : null}
          {!layoutState.hasTitle && !layoutState.hasDescription ? null : (
            <div className="my-auto flex min-w-0 flex-col gap-0.5" data-slot="notice-content">
              {layoutState.hasTitle ? <NoticeTitle>{title}</NoticeTitle> : null}
              {layoutState.hasDescription ? (
                <NoticeDescription>{children}</NoticeDescription>
              ) : null}
            </div>
          )}
        </div>
      )}
      {layoutState.hasAction ? <NoticeAction>{action}</NoticeAction> : null}
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
        "text-sm text-balance md:text-pretty [&_a]:hover:text-foreground [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
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
      className={cn("my-auto ml-auto shrink-0", className)}
      data-slot="notice-action"
      {...props}
    />
  );
}

export { Notice, NoticeAction, NoticeDescription, NoticeIcon, NoticeTitle };
export type { NoticeProps };

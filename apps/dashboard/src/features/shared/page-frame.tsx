import { cn } from "@mistle/ui";

import type { AppPageMeta } from "../navigation/route-meta.js";
import { FormPageHeader } from "./form-page.js";
import { usePageHeaderSidebarTrigger } from "./page-header-sidebar-trigger-context.js";

export type PageFrameWidth = "form" | "full" | "normal";
export type PageFrameVariant = "default" | "tabbed";

export type PageFrameProps = {
  breadcrumbs?: React.ReactNode;
  children: React.ReactNode;
  description?: React.ReactNode;
  headerActions?: React.ReactNode;
  headerIcon?: React.ReactNode;
  title?: React.ReactNode;
  titleSlot?: React.ReactNode;
  variant?: PageFrameVariant;
  width?: PageFrameWidth;
};

export function resolvePageFrameText(
  pageMeta: AppPageMeta,
  fallbackTitle: string,
): {
  description: string | undefined;
  title: string;
} {
  return {
    description:
      pageMeta.supportingText === null || pageMeta.supportingText.trim().length === 0
        ? undefined
        : pageMeta.supportingText,
    title: pageMeta.title ?? fallbackTitle,
  };
}

function shouldRenderPageFrameHeader(input: Omit<PageFrameProps, "children">): boolean {
  const hasTitle =
    typeof input.title === "string"
      ? input.title.trim().length > 0
      : input.title !== null && input.title !== undefined;
  const hasTitleSlot = input.titleSlot !== undefined && input.titleSlot !== null;
  const hasDescription = input.description !== undefined && input.description !== null;
  const hasHeaderActions = input.headerActions !== undefined && input.headerActions !== null;
  const hasHeaderIcon = input.headerIcon !== undefined && input.headerIcon !== null;

  return hasTitle || hasTitleSlot || hasDescription || hasHeaderActions || hasHeaderIcon;
}

export function PageFrame(input: PageFrameProps): React.JSX.Element {
  const variant = input.variant ?? "default";
  const pageHeaderSidebarTrigger = usePageHeaderSidebarTrigger();
  const hasPageHeaderContent = shouldRenderPageFrameHeader(input);
  const hasBreadcrumbs = input.breadcrumbs !== undefined && input.breadcrumbs !== null;
  const shouldRenderBreadcrumbToolbar = hasBreadcrumbs;
  const shouldRenderPageHeader = hasPageHeaderContent || pageHeaderSidebarTrigger.isVisible;
  const width = input.width ?? "full";
  const contentClassName = resolvePageFrameContentClassName(width);
  const breadcrumbToolbarClassNames = resolvePageFrameBreadcrumbToolbarClassNames(width);
  const renderedHeader =
    hasBreadcrumbs || shouldRenderPageHeader ? (
      <div className="relative min-w-0">
        <div className="flex flex-col gap-2">
          {shouldRenderBreadcrumbToolbar ? (
            <div
              className={breadcrumbToolbarClassNames.toolbar}
              data-slot="page-frame-breadcrumb-toolbar"
            >
              {pageHeaderSidebarTrigger.isVisible ? (
                <div
                  className={breadcrumbToolbarClassNames.trigger}
                  data-slot="page-frame-breadcrumb-trigger"
                >
                  {pageHeaderSidebarTrigger.control}
                </div>
              ) : null}
              <div
                className={breadcrumbToolbarClassNames.breadcrumbs}
                data-slot="page-frame-breadcrumb-content"
              >
                {input.breadcrumbs}
              </div>
            </div>
          ) : null}
          {shouldRenderPageHeader ? (
            <div className={contentClassName}>
              <FormPageHeader
                actions={input.headerActions}
                description={input.description}
                icon={input.headerIcon}
                leadingControl={
                  !hasBreadcrumbs && pageHeaderSidebarTrigger.isVisible
                    ? pageHeaderSidebarTrigger.control
                    : null
                }
                title={input.title}
                titleSlot={input.titleSlot}
              />
            </div>
          ) : null}
        </div>
      </div>
    ) : null;

  if (variant === "tabbed") {
    return (
      <div className="flex min-h-full flex-col">
        {renderedHeader === null ? null : (
          <div className="p-4" data-slot="page-frame-above-tabs">
            {renderedHeader}
          </div>
        )}
        <div className="min-h-0 flex-1" data-slot="page-frame-below-tabs">
          {input.children}
        </div>
      </div>
    );
  }

  const rootClassName = cn(
    "flex min-h-full flex-col",
    input.width === "form" ? "gap-6 bg-muted/30" : "gap-4",
    "p-4",
  );

  return (
    <div className={rootClassName}>
      {renderedHeader}
      <div className={contentClassName}>{input.children}</div>
    </div>
  );
}

function resolvePageFrameContentClassName(width: PageFrameWidth): string | undefined {
  switch (width) {
    case "form":
      return "mx-auto w-full max-w-2xl";
    case "full":
      return undefined;
    case "normal":
      return "mx-auto w-full max-w-5xl";
  }
}

function resolvePageFrameBreadcrumbToolbarClassNames(width: PageFrameWidth): {
  breadcrumbs: string;
  toolbar: string;
  trigger: string;
} {
  switch (width) {
    case "form":
      return {
        breadcrumbs: "min-w-0 flex-1 min-[47rem]:mx-auto min-[47rem]:w-full min-[47rem]:max-w-2xl",
        toolbar: "relative flex min-w-0 items-center gap-2 min-[47rem]:block",
        trigger:
          "shrink-0 min-[47rem]:absolute min-[47rem]:top-1/2 min-[47rem]:left-0 min-[47rem]:-translate-y-1/2",
      };
    case "full":
      return {
        breadcrumbs: "min-w-0 flex-1",
        toolbar: "flex min-w-0 items-center gap-2",
        trigger: "shrink-0",
      };
    case "normal":
      return {
        breadcrumbs: "min-w-0 flex-1 min-[69rem]:mx-auto min-[69rem]:w-full min-[69rem]:max-w-5xl",
        toolbar: "relative flex min-w-0 items-center gap-2 min-[69rem]:block",
        trigger:
          "shrink-0 min-[69rem]:absolute min-[69rem]:top-1/2 min-[69rem]:left-0 min-[69rem]:-translate-y-1/2",
      };
  }
}
